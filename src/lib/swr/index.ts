/**
 * SWR 模块导出
 */

export { SWRProvider, default } from './provider';
export { 
  fetcher, 
  authFetcher, 
  postFetcher, 
  parallelFetcher,
  type FetcherError,
  type FetcherOptions,
} from './fetcher';
