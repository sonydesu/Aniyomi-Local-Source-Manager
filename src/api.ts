import { Anime, ApiResponse, Episode } from './types';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

// Helper to handle rate limiting by waiting between requests
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function searchAnime(query: string, page: number = 1): Promise<Anime[]> {
  const url = new URL(`${JIKAN_BASE_URL}/anime`);
  url.searchParams.append('q', query);
  url.searchParams.append('page', page.toString());
  url.searchParams.append('sfw', 'true'); // Safe for work mostly
  url.searchParams.append('limit', '24');

  const response = await fetch(url.toString());
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (response.status === 404) {
      throw new Error('No anime found for the given search query.');
    }
    if (response.status >= 500) {
      throw new Error(`Jikan API Server Error (${response.status}). Please try again later.`);
    }
    throw new Error(`Failed to search anime (Status: ${response.status}).`);
  }

  const result: ApiResponse<Anime[]> = await response.json();
  return result.data || [];
}

export async function getAnimeDetails(id: number): Promise<Anime> {
  const response = await fetch(`${JIKAN_BASE_URL}/anime/${id}`);
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (response.status === 404) {
      throw new Error('Anime details not found (404). It may have been removed.');
    }
    if (response.status >= 500) {
      throw new Error(`Jikan API Server Error (${response.status}). Please try again later.`);
    }
    throw new Error(`Failed to fetch anime details (Status: ${response.status}).`);
  }
  const result: ApiResponse<Anime> = await response.json();
  return result.data;
}

export async function getAnimeEpisodes(id: number): Promise<Episode[]> {
  let allEpisodes: Episode[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await fetch(`${JIKAN_BASE_URL}/anime/${id}/episodes?page=${page}`);
    if (!response.ok) {
        if (response.status === 429) {
            // Wait and retry once
            await delay(1000);
            continue;
        }
        if (response.status === 404) {
            console.warn('Episodes not found for this anime.');
            break;
        }
        if (response.status >= 500) {
            console.warn(`Jikan API Server Error (${response.status}) while fetching episodes.`);
            break;
        }
        console.warn(`Failed to fetch episodes or episode list is empty (Status: ${response.status}).`);
        break;
    }

    const data: ApiResponse<Episode[]> = await response.json();
    if (data.data) {
      allEpisodes = [...allEpisodes, ...data.data];
    }

    if (data.pagination && data.pagination.has_next_page) {
      page++;
      await delay(400); // 3 requests per second limit on Jikan
    } else {
      hasNextPage = false;
    }
  }

  return allEpisodes;
}
