/**
 * X API client for fetching user profiles and tweet data.
 */

import { Client } from "@xdevplatform/xdk";

export interface XUserProfile {
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string;
  followers: number;
}

export interface XTweetData {
  id: string;
  text: string;
  authorName: string;
  authorUsername: string;
  mediaType?: "image" | "video" | "gif";
}

export function createXClient(bearerToken: string): Client {
  return new Client({ bearerToken });
}

export async function fetchUserProfile(client: Client, username: string): Promise<XUserProfile> {
  const response = await client.users.getByUsername(username, {
    userFields: ["name", "username", "profile_image_url", "public_metrics"],
  });

  const user = response.data;
  if (!user) {
    throw new Error(`User @${username} not found`);
  }

  const metrics = user.publicMetrics as Record<string, number> | undefined;

  return {
    id: user.id as string,
    name: user.name as string,
    username: user.username as string,
    profileImageUrl: user.profileImageUrl as string | undefined,
    followers: metrics?.followersCount ?? 0,
  };
}

/** Extract a tweet ID from a URL like https://x.com/user/status/123456 */
export function extractTweetId(urlOrId: string): string | null {
  const match = urlOrId.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/);
  if (match) return match[1];
  // If it's already a numeric ID
  if (/^\d+$/.test(urlOrId.trim())) return urlOrId.trim();
  return null;
}

export async function fetchTweet(client: Client, tweetId: string): Promise<XTweetData> {
  const response = await client.posts.getById(tweetId, {
    tweetFields: ["text", "author_id", "attachments"],
    expansions: ["author_id", "attachments.media_keys"],
    mediaFields: ["type"],
    userFields: ["name", "username"],
  });

  const tweet = response.data;
  if (!tweet) {
    throw new Error(`Tweet ${tweetId} not found`);
  }

  // Get author from includes
  const includes = response.includes as
    | { users?: Array<{ name?: string; username?: string }>; media?: Array<{ type?: string }> }
    | undefined;

  const author = includes?.users?.[0];
  const media = includes?.media?.[0];

  let mediaType: XTweetData["mediaType"] | undefined;
  if (media?.type) {
    const t = media.type as string;
    if (t === "animated_gif") mediaType = "gif";
    else if (t === "video") mediaType = "video";
    else if (t === "photo") mediaType = "image";
  }

  return {
    id: tweetId,
    text: (tweet.text ?? "") as string,
    authorName: (author?.name ?? "Unknown") as string,
    authorUsername: (author?.username ?? "unknown") as string,
    mediaType,
  };
}
