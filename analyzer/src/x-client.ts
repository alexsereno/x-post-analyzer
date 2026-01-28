/**
 * X API client for fetching user profiles and tweet data.
 */

import { Client } from "@xdevplatform/xdk";
import type { XApiUsage } from "./types.js";

let xApiReads = 0;
let xApiWrites = 0;
let xApiEndpoints: string[] = [];

export function getXApiUsage(): XApiUsage {
  return { reads: xApiReads, writes: xApiWrites, endpoints: [...xApiEndpoints] };
}

export function resetXApiUsage(): void {
  xApiReads = 0;
  xApiWrites = 0;
  xApiEndpoints = [];
}

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
  xApiReads++;
  xApiEndpoints.push("getByUsername");
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

export interface XSearchTweet {
  text: string;
  mediaType: "image" | "video" | "gif" | "none";
  authorFollowers: number;
  likeCount: number;
  replyCount: number;
  retweetCount: number;
  quoteCount: number;
  bookmarkCount: number;
  impressionCount?: number;
}

export async function searchRecentTweets(
  client: Client,
  query: string,
  maxResults: number = 10
): Promise<XSearchTweet[]> {
  xApiReads++;
  xApiEndpoints.push("searchRecent");
  const response = await client.posts.searchRecent(query, {
    tweetFields: ["public_metrics", "created_at", "attachments"],
    expansions: ["author_id", "attachments.media_keys"],
    userFields: ["public_metrics"],
    mediaFields: ["type"],
    maxResults,
  });

  const data = response.data;
  if (!data || data.length === 0) return [];

  const includes = response.includes as
    | {
        users?: Array<{ id?: string; publicMetrics?: Record<string, number> }>;
        media?: Array<{ mediaKey?: string; type?: string }>;
      }
    | undefined;

  const userMap = new Map<string, number>();
  for (const u of includes?.users ?? []) {
    if (u.id) userMap.set(u.id, u.publicMetrics?.followersCount ?? 0);
  }

  const mediaMap = new Map<string, string>();
  for (const m of includes?.media ?? []) {
    if (m.mediaKey) mediaMap.set(m.mediaKey, m.type ?? "");
  }

  const results: XSearchTweet[] = [];
  for (const tweet of data) {
    const metrics = tweet.publicMetrics as Record<string, number> | undefined;
    const authorId = tweet.authorId as string | undefined;
    const attachments = tweet.attachments as { mediaKeys?: string[] } | undefined;

    let mediaType: XSearchTweet["mediaType"] = "none";
    const firstMediaKey = attachments?.mediaKeys?.[0];
    if (firstMediaKey) {
      const t = mediaMap.get(firstMediaKey) ?? "";
      if (t === "animated_gif") mediaType = "gif";
      else if (t === "video") mediaType = "video";
      else if (t === "photo") mediaType = "image";
    }

    results.push({
      text: (tweet.text ?? "") as string,
      mediaType,
      authorFollowers: authorId ? (userMap.get(authorId) ?? 0) : 0,
      likeCount: metrics?.likeCount ?? 0,
      replyCount: metrics?.replyCount ?? 0,
      retweetCount: metrics?.retweetCount ?? 0,
      quoteCount: metrics?.quoteCount ?? 0,
      bookmarkCount: metrics?.bookmarkCount ?? 0,
      impressionCount: metrics?.impressionCount,
    });
  }

  return results;
}

export async function fetchTweet(client: Client, tweetId: string): Promise<XTweetData> {
  xApiReads++;
  xApiEndpoints.push("getById");
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

export interface PostTweetOptions {
  text: string;
  replyToTweetId?: string;
  quoteTweetId?: string;
}

export interface PostTweetResult {
  id: string;
}

export async function postTweet(
  client: Client,
  options: PostTweetOptions
): Promise<PostTweetResult> {
  xApiWrites++;
  xApiEndpoints.push("create");

  const body: Record<string, unknown> = { text: options.text };

  if (options.replyToTweetId) {
    body.reply = { inReplyToTweetId: options.replyToTweetId };
  }
  if (options.quoteTweetId) {
    body.quoteTweetId = options.quoteTweetId;
  }

  const response = await client.posts.create(body as Parameters<typeof client.posts.create>[0]);

  const data = response.data as Record<string, unknown> | undefined;
  if (!data?.id) {
    throw new Error("Failed to post tweet — no ID returned");
  }

  return { id: data.id as string };
}
