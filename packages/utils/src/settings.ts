import dotenv from 'dotenv';
import path from 'path';

try {
  dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
} catch (error) {
  console.error('Error loading .env file', error);
}

export class Settings {
  public static readonly ADDON_NAME = process.env.ADDON_NAME ?? 'AIOStreams';
  public static readonly ADDON_ID =
    process.env.ADDON_ID || 'aiostreams.viren070.com';
  public static readonly PORT = process.env.PORT || 3000;
  public static readonly BRANDING =
    process.env.BRANDING ?? process.env.NEXT_PUBLIC_ELFHOSTED_BRANDING;
  public static readonly SECRET_KEY = process.env.SECRET_KEY ?? '';
  public static readonly CUSTOM_CONFIGS = process.env.CUSTOM_CONFIGS || '';
  public static readonly DISABLE_CUSTOM_CONFIG_GENERATOR_ROUTE =
    process.env.DISABLE_CUSTOM_CONFIG_GENERATOR_ROUTE === 'true';
  public static readonly DETERMINISTIC_ADDON_ID = process.env
    .DETERMINISTIC_ADDON_ID
    ? process.env.DETERMINISTIC_ADDON_ID === 'true'
    : false;
  public static readonly API_KEY = process.env.API_KEY ?? '';
  public static readonly TMDB_API_KEY = process.env.TMDB_API_KEY || '';
  public static readonly SHOW_DIE = process.env.SHOW_DIE
    ? process.env.SHOW_DIE === 'true'
    : false;
  public static readonly LOG_SENSITIVE_INFO = process.env.LOG_SENSITIVE_INFO
    ? process.env.LOG_SENSITIVE_INFO === 'true'
    : false;
  public static readonly ADDON_PROXY = process.env.ADDON_PROXY ?? '';
  public static readonly ADDON_PROXY_CONFIG = process.env.ADDON_PROXY_CONFIG
    ? process.env.ADDON_PROXY_CONFIG
    : undefined;
  public static readonly DISABLE_TORRENTIO = process.env.DISABLE_TORRENTIO
    ? process.env.DISABLE_TORRENTIO === 'true'
    : false;
  public static readonly DISABLE_TORRENTIO_MESSAGE =
    process.env.DISABLE_TORRENTIO_MESSAGE ||
    'The Torrentio addon has been disabled, please remove it to use this addon.';
  public static readonly LOG_LEVEL = process.env.LOG_LEVEL || 'info';
  public static readonly LOG_FORMAT = process.env.LOG_FORMAT
    ? process.env.LOG_FORMAT === 'json'
      ? 'json'
      : 'text'
    : 'text';

  // Cache settings
  public static readonly CACHE_STREAM_RESULTS = process.env.CACHE_STREAM_RESULTS
    ? process.env.CACHE_STREAM_RESULTS === 'true'
    : false;
  public static readonly CACHE_STREAM_RESULTS_TTL = process.env
    .CACHE_STREAM_RESULTS_TTL
    ? parseInt(process.env.CACHE_STREAM_RESULTS_TTL)
    : 600;
  public static readonly CACHE_MEDIAFLOW_IP_TTL = process.env
    .CACHE_MEDIAFLOW_IP_TTL
    ? parseInt(process.env.CACHE_MEDIAFLOW_IP_TTL)
    : 900;
  public static readonly CACHE_MEDIAFUSION_CONFIG_TTL = process.env
    .CACHE_MEDIAFUSION_CONFIG_TTL
    ? parseInt(process.env.CACHE_MEDIAFUSION_CONFIG_TTL)
    : 30 * 24 * 60 * 60; // 30 days
  public static readonly MAX_CACHE_SIZE = process.env.MAX_CACHE_SIZE
    ? parseInt(process.env.MAX_CACHE_SIZE)
    : 10240;

  // Configuration Constants
  public static readonly MAX_ADDONS = process.env.MAX_ADDONS
    ? parseInt(process.env.MAX_ADDONS)
    : 15;
  public static readonly MAX_KEYWORD_FILTERS = process.env.MAX_KEYWORD_FILTERS
    ? parseInt(process.env.MAX_KEYWORD_FILTERS)
    : 30;
  public static readonly MAX_MOVIE_SIZE = process.env.MAX_MOVIE_SIZE
    ? parseInt(process.env.MAX_MOVIE_SIZE)
    : 161061273600; // 150GiB
  public static readonly MAX_EPISODE_SIZE = process.env.MAX_EPISODE_SIZE
    ? parseInt(process.env.MAX_EPISODE_SIZE)
    : 161061273600; // 150GiB
  public static readonly MAX_TIMEOUT = process.env.MAX_TIMEOUT
    ? parseInt(process.env.MAX_TIMEOUT)
    : 50000;
  public static readonly MIN_TIMEOUT = process.env.MIN_TIMEOUT
    ? parseInt(process.env.MIN_TIMEOUT)
    : 1000;
  public static readonly DEFAULT_TIMEOUT = process.env.DEFAULT_TIMEOUT
    ? parseInt(process.env.DEFAULT_TIMEOUT)
    : 15000;

  // MediaFlow settings
  public static readonly DEFAULT_MEDIAFLOW_URL =
    process.env.DEFAULT_MEDIAFLOW_URL ?? '';
  public static readonly DEFAULT_MEDIAFLOW_API_PASSWORD =
    process.env.DEFAULT_MEDIAFLOW_API_PASSWORD ?? '';
  public static readonly DEFAULT_MEDIAFLOW_PUBLIC_IP =
    process.env.DEFAULT_MEDIAFLOW_PUBLIC_IP ?? '';
  public static readonly MEDIAFLOW_IP_TIMEOUT = process.env.MEDIAFLOW_IP_TIMEOUT
    ? parseInt(process.env.MEDIAFLOW_IP_TIMEOUT)
    : 30000;
  public static readonly ENCRYPT_MEDIAFLOW_URLS = process.env
    .ENCRYPT_MEDIAFLOW_URLS
    ? process.env.ENCRYPT_MEDIAFLOW_URLS === 'true'
    : false;

  // Comet settings
  public static readonly COMET_URL =
    process.env.COMET_URL || 'https://comet.elfhosted.com/';
  public static readonly COMET_INDEXERS = process.env.COMET_INDEXERS
    ? JSON.parse(process.env.COMET_INDEXERS)
    : ['dmm_public_hash_shares_only'];
  public static readonly FORCE_COMET_HOSTNAME = process.env.FORCE_COMET_HOSTNAME
    ? process.env.FORCE_COMET_HOSTNAME
    : null;
  public static readonly FORCE_COMET_PORT = process.env.FORCE_COMET_PORT
    ? process.env.FORCE_COMET_PORT
    : null;
  public static readonly FORCE_COMET_PROTOCOL = process.env.FORCE_COMET_PROTOCOL
    ? process.env.FORCE_COMET_PROTOCOL
    : null;
  public static readonly DEFAULT_COMET_TIMEOUT = process.env
    .DEFAULT_COMET_TIMEOUT
    ? parseInt(process.env.DEFAULT_COMET_TIMEOUT)
    : undefined;

  // MediaFusion settings
  public static readonly MEDIAFUSION_URL =
    process.env.MEDIAFUSION_URL || 'https://mediafusion.elfhosted.com/';
  public static readonly MEDIAFUSION_API_PASSWORD =
    process.env.MEDIAFUSION_API_PASSWORD ?? '';
  public static readonly DEFAULT_MEDIAFUSION_TIMEOUT = process.env
    .DEFAULT_MEDIAFUSION_TIMEOUT
    ? parseInt(process.env.DEFAULT_MEDIAFUSION_TIMEOUT)
    : undefined;
  public static readonly MEDIAFUSION_CONFIG_TIMEOUT = process.env
    .MEDIAFUSION_CONFIG_TIMEOUT
    ? parseInt(process.env.MEDIAFUSION_CONFIG_TIMEOUT)
    : 5000;

  // Jackettio settings
  public static readonly JACKETTIO_URL =
    process.env.JACKETTIO_URL || 'https://jackettio.elfhosted.com/';
  public static readonly JACKETT_INDEXERS = process.env.JACKETT_INDEXERS
    ? JSON.parse(process.env.JACKETT_INDEXERS)
    : ['bitsearch', 'eztv', 'thepiratebay', 'therarbg', 'yts'];
  public static readonly DEFAULT_JACKETTIO_TIMEOUT = process.env
    .DEFAULT_JACKETTIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_JACKETTIO_TIMEOUT)
    : undefined;

  // Stremio Jackett settings
  public static readonly STREMIO_JACKETT_URL =
    process.env.STREMIO_JACKETT_URL || 'https://stremio-jackett.elfhosted.com/';
  public static readonly JACKETT_URL = process.env.JACKETT_URL || null;
  public static readonly JACKETT_API_KEY = process.env.JACKETT_API_KEY || null;
  public static readonly STREMIO_JACKETT_CACHE_ENABLED = process.env
    .STREMIO_JACKETT_CACHE_ENABLED
    ? process.env.STREMIO_JACKETT_CACHE_ENABLED !== 'false'
    : true;
  public static readonly DEFAULT_STREMIO_JACKETT_TIMEOUT = process.env
    .DEFAULT_STREMIO_JACKETT_TIMEOUT
    ? parseInt(process.env.DEFAULT_STREMIO_JACKETT_TIMEOUT)
    : undefined;

  // Torrentio settings
  public static readonly TORRENTIO_URL =
    process.env.TORRENTIO_URL || 'https://torrentio.strem.fun/';
  public static readonly DEFAULT_TORRENTIO_TIMEOUT = process.env
    .DEFAULT_TORRENTIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_TORRENTIO_TIMEOUT)
    : undefined;

  public static readonly ORION_STREMIO_ADDON_URL =
    process.env.ORION_STREMIO_ADDON_URL ||
    'https://5a0d1888fa64-orion.baby-beamup.club/';
  public static readonly DEFAULT_ORION_TIMEOUT = process.env
    .DEFAULT_ORION_TIMEOUT
    ? parseInt(process.env.DEFAULT_ORION_TIMEOUT)
    : undefined;

  public static readonly PEERFLIX_URL =
    process.env.PEERFLIX_URL || 'https://peerflix-addon.onrender.com/';
  public static readonly DEFAULT_PEERFLIX_TIMEOUT = process.env
    .DEFAULT_PEERFLIX_TIMEOUT
    ? parseInt(process.env.DEFAULT_PEERFLIX_TIMEOUT)
    : undefined;

  public static readonly TORBOX_STREMIO_URL =
    process.env.TORBOX_STREMIO_URL || 'https://stremio.torbox.app/';
  public static readonly DEFAULT_TORBOX_TIMEOUT = process.env
    .DEFAULT_TORBOX_TIMEOUT
    ? parseInt(process.env.DEFAULT_TORBOX_TIMEOUT)
    : undefined;

  public static readonly EASYNEWS_URL =
    process.env.EASYNEWS_URL ||
    'https://ea627ddf0ee7-easynews.baby-beamup.club/';
  public static readonly DEFAULT_EASYNEWS_TIMEMOUT = process.env
    .DEFAULT_EASYNEWS_TIMEMOUT
    ? parseInt(process.env.DEFAULT_EASYNEWS_TIMEMOUT)
    : undefined;

  public static readonly EASYNEWS_PLUS_URL =
    process.env.EASYNEWS_PLUS_URL ||
    'https://b89262c192b0-stremio-easynews-addon.baby-beamup.club/';
  public static readonly DEFAULT_EASYNEWS_PLUS_TIMEMOUT = process.env
    .DEFAULT_EASYNEWS_PLUS_TIMEMOUT
    ? parseInt(process.env.DEFAULT_EASYNEWS_PLUS_TIMEMOUT)
    : undefined;

  public static readonly DEBRIDIO_URL =
    process.env.DEBRIDIO_URL || 'https://debridio.adobotec.com/';
  public static readonly DEFAULT_DEBRIDIO_TIMEOUT = process.env
    .DEFAULT_DEBRIDIO_TIMEOUT
    ? parseInt(process.env.DEFAULT_DEBRIDIO_TIMEOUT)
    : undefined;

  public static readonly DEFAULT_DMM_CAST_TIMEOUT = process.env
    .DEFAULT_DMM_CAST_TIMEOUT
    ? parseInt(process.env.DEFAULT_DMM_CAST_TIMEOUT)
    : undefined;

  public static readonly DEFAULT_GDRIVE_TIMEOUT = process.env
    .DEFAULT_GDRIVE_TIMEOUT
    ? parseInt(process.env.DEFAULT_GDRIVE_TIMEOUT)
    : undefined;
}
