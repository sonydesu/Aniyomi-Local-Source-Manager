export interface Anime {
  mal_id: number;
  title: string;
  title_english: string | null;
  title_japanese: string | null;
  title_synonyms: string[];
  images: {
    webp: {
      image_url: string;
      large_image_url: string;
    };
  };
  synopsis: string;
  background: string | null;
  episodes: number | null;
  duration: string | null;
  rating: string | null;
  score: number | null;
  scored_by: number | null;
  rank: number | null;
  popularity: number | null;
  genres: Array<{ mal_id: number; name: string }>;
  explicit_genres: Array<{ mal_id: number; name: string }>;
  themes: Array<{ mal_id: number; name: string }>;
  demographics: Array<{ mal_id: number; name: string }>;
  status: string;
  aired: {
    string: string;
    from: string | null;
    to: string | null;
  };
  type: string;
  year: number | null;
  season?: string | null;
  studios: Array<{ name: string }>;
  producers: Array<{ name: string }>;
  licensors: Array<{ name: string }>;
}

export interface Episode {
  mal_id: number;
  title: string;
  episode: string;
  aired: string | null;
  score: number | null;
  filler: boolean;
  recap: boolean;
  forum_url?: string;
}

export interface Pagination {
  last_visible_page: number;
  has_next_page: boolean;
}

export interface ApiResponse<T> {
  data: T;
  pagination?: Pagination;
}
