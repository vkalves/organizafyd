import { describe, it, expect } from 'vitest';
import { validatePost } from './model';
const post = { account_id: 'account', caption: 'Legenda', format: 'Feed' as const, media_urls: ['https://example.com/photo.jpg'], scheduled_at: '2030-01-01T12:00:00Z' };
describe('Instagram publication preparation', () => {
 it('accepts an incomplete draft but not queued content without media', () => {
  expect(() => validatePost({...post, media_urls: [], scheduled_at: null}, false)).not.toThrow();
  expect(() => validatePost({...post, media_urls: []}, true)).toThrow();
 });
 it('rejects missing accounts, overlong captions and unsafe media links', () => {
  expect(() => validatePost({...post, account_id: ''}, false)).toThrow();
  expect(() => validatePost({...post, caption: 'a'.repeat(2201)}, false)).toThrow();
  for (const url of ['javascript:alert(1)', 'http://example.com/a', 'https://user:password@example.com/a', 'broken']) expect(() => validatePost({...post, media_urls: [url]}, false)).toThrow();
 });
 it('requires future scheduling and rejects malformed dates', () => {
  expect(() => validatePost(post, true, Date.parse('2029-01-01'))).not.toThrow();
  expect(() => validatePost(post, true, Date.parse('2031-01-01'))).toThrow();
  expect(() => validatePost({...post, scheduled_at: 'invalid'}, false)).toThrow();
 });
 it('validates per-format media counts', () => {
  expect(() => validatePost({...post, media_urls: [post.media_urls[0], post.media_urls[0]]}, true)).toThrow();
  expect(() => validatePost({...post, format: 'Carrossel'}, true)).toThrow();
  expect(() => validatePost({...post, format: 'Carrossel', media_urls: Array(10).fill(post.media_urls[0])}, true)).not.toThrow();
  expect(() => validatePost({...post, format: 'Carrossel', media_urls: Array(11).fill(post.media_urls[0])}, false)).toThrow();
 });
});
