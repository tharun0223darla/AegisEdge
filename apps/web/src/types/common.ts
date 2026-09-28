/** Generic paginated response shape used across many list endpoints. */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages?: number;
  };
}

/** Backend error envelope (NestJS default exception filter shape). */
export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp?: string;
  path?: string;
}

export type Id = string;
