// @flow
import type { GraphQLContext } from '../../';
import type { CreateCommunityInput } from '../../models/community';
import UserError from '../../utils/UserError';
import { communitySlugIsBlacklisted } from '../../utils/permissions';
import { getCommunitiesBySlug, createCommunity } from '../../models/community';
import { createOwnerInCommunity } from '../../models/usersCommunities';
import { createGeneralChannel } from '../../models/channel';
import { createOwnerInChannel } from '../../models/usersChannels';
import { isAuthedResolver as requireAuth } from '../../utils/permissions';
import { trackQueue } from 'shared/bull/queues';
import { events } from 'shared/analytics';

export default requireAuth(
  async (_: any, args: CreateCommunityInput, { user }: GraphQLContext) => {
    if (!user.email) {
      trackQueue.add({
        userId: user.id,
        event: events.COMMUNITY_CREATED_FAILED,
        properties: {
          reason: 'no email address',
        },
      });
      return new UserError(
        'You must have a working email address to create communities. Add an email address in your settings.'
      );
    }

    if (!args.input.slug || args.input.slug.length === 0) {
      trackQueue.add({
        userId: user.id,
        event: events.COMMUNITY_CREATED_FAILED,
        properties: {
          reason: 'no slug',
        },
      });

      return new UserError(
        'Communities must have a valid url so people can find it!'
      );
    }

    // replace any non alpha-num characters to prevent bad community slugs
    // (/[\W_]/g, "-") => replace non-alphanum with hyphens
    // (/-{2,}/g, '-') => replace multiple hyphens in a row with one hyphen
    const sanitizedSlug = args.input.slug
      .replace(/[\W_]/g, '-')
      .replace(/-{2,}/g, '-');
    const sanitizedArgs = Object.assign(
      {},
      {
        ...args,
        input: {
          ...args.input,
          slug: sanitizedSlug,
        },
      }
    );

    if (communitySlugIsBlacklisted(sanitizedSlug)) {
      trackQueue.add({
        userId: user.id,
        event: events.COMMUNITY_CREATED_FAILED,
        properties: {
          reason: 'url taken',
        },
      });

      return new UserError(
        `This url is already taken - feel free to change it if
        you're set on the name ${args.input.name}!`
      );
    }

    // get communities with the input slug to check for duplicates
    const communities = await getCommunitiesBySlug([sanitizedSlug]);

    // if a community with this slug already exists
    if (communities.length > 0) {
      trackQueue.add({
        userId: user.id,
        event: events.COMMUNITY_CREATED_FAILED,
        properties: {
          reason: 'community already exists',
        },
      });

      return new UserError('A community with this slug already exists.');
    }

    // all checks passed
    const community = await createCommunity(sanitizedArgs, user);

    // create a new relationship with the community
    const communityRelationship = await createOwnerInCommunity(
      community.id,
      user.id
    );

    // create a default 'general' channel
    const generalChannel = await createGeneralChannel(community.id, user.id);

    // create a new relationship with the general channel
    const generalChannelRelationship = createOwnerInChannel(
      generalChannel.id,
      user.id
    );

    return Promise.all([
      communityRelationship,
      generalChannelRelationship,
    ]).then(() => community);
  }
);
