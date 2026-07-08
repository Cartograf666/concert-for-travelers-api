import { z } from 'zod';

export const ArtistSocialsSchema = z.object({
  spotify: z.string().nullable().optional(),
  instagram: z.string().nullable().optional(),
  facebook: z.string().nullable().optional(),
  youtube: z.string().nullable().optional(),
  telegram: z.string().nullable().optional(),
  vk: z.string().nullable().optional()
});

export type ArtistSocials = z.infer<typeof ArtistSocialsSchema>;

export const SimilarArtistRefSchema = z.object({
  name: z.string(),
  slug: z.string(),
  match: z.number()
});

export type SimilarArtistRef = z.infer<typeof SimilarArtistRefSchema>;

export const ArtistEntrySchema = z.object({
  name: z.string(),
  website: z.string().nullable().optional(),
  socials: ArtistSocialsSchema.optional(),
  tourUrl: z.string().nullable().optional(),
  enrichedAt: z.string().optional(),
  sitesTriedAt: z.string().optional(),
  tourUrlProbeTriedAt: z.string().optional(),
  artistCheckedAt: z.string().optional(),
  mbid: z.string().optional(),
  genres: z.array(z.string()).optional(),
  popularity: z.object({
    listeners: z.number(),
    playcount: z.number()
  }).optional(),
  image: z.string().optional(),
  metaEnrichedAt: z.string().optional(),
  metaTriedAt: z.string().optional(),
  enrichedBy: z.string().optional(),
  autoTriedAt: z.string().optional(),
  wdBulkTriedAt: z.string().optional(),
  similarArtists: z.array(SimilarArtistRefSchema).optional(),
  similarEnrichedAt: z.string().optional(),
  similarTriedAt: z.string().optional(),
  mbidBackfillTriedAt: z.string().optional()
}).catchall(z.any());

export type ArtistEntry = z.infer<typeof ArtistEntrySchema>;
