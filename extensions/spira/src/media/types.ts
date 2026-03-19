export const MEDIA_ACTIONS = [
  "text_to_image",
  "image_to_video",
  "video_frames",
  "caption_video",
] as const;

export type MediaAction = (typeof MEDIA_ACTIONS)[number];
export type MediaProviderName = "spira" | "viral-well-tools";
