export interface Anime {
  mal_id: number;
  title: string;
  title_english: string | null;
  images: {
    webp: {
      image_url: string;
      large_image_url: string;
    };
  };
  synopsis: string;
  episodes: number | null;
  score: number | null;
  genres: Array<{ mal_id: number; name: string }>;
  status: string;
  aired: {
    string: string;
    from: string | null;
  };
  type: string;
  year: number | null;
  studios: Array<{ name: string }>;
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
