import { Anime, ApiResponse, Episode } from './types';

const JIKAN_BASE_URL = 'https://api.jikan.moe/v4';

// Helper to handle rate limiting by waiting between requests
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function searchAnime(query: string, page: number = 1): Promise<ApiResponse<Anime[]>> {
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
    throw new Error('Failed to search anime.');
  }

  return response.json();
}

export async function getAnimeDetails(id: number): Promise<Anime> {
  const response = await fetch(`${JIKAN_BASE_URL}/anime/${id}`);
  if (!response.ok) {
    throw new Error('Failed to fetch anime details.');
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
        console.warn('Failed to fetch episodes or episode list is empty.');
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
