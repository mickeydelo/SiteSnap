/**
 * Shared Blobs store factory.
 *
 * Netlify only auto-injects the Blobs context into regular functions.
 * Background functions need explicit siteID + token.
 *
 * Required env var (set once in Netlify dashboard → Site settings → Environment variables):
 *   NETLIFY_AUTH_TOKEN  — a Netlify personal access token
 *                         (User settings → Applications → Personal access tokens)
 */
import { getStore } from '@netlify/blobs';

function storeOpts() {
  return {
    siteID: process.env.SITE_ID,
    token:  process.env.NETLIFY_AUTH_TOKEN,
  };
}

export const jobsStore        = () => getStore({ name: 'sitesnap-jobs',        ...storeOpts() });
export const screenshotsStore = () => getStore({ name: 'sitesnap-screenshots', ...storeOpts() });
export const zipsStore        = () => getStore({ name: 'sitesnap-zips',        ...storeOpts() });
