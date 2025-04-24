import { Config } from '@aiostreams/types';
import path from 'path';
import { Settings } from './settings';
import { getTextHash } from './crypto';
import { Cache } from './cache';
import { createLogger } from './logger';

const logger = createLogger('mediaflow');

const PRIVATE_CIDR = /^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/;

export async function createProxiedMediaFlowUrl(
  url: string,
  mediaFlowConfig: Config['mediaFlowConfig'],
  headers?: {
    request?: Record<string, string>;
    response?: Record<string, string>;
  }
) {
  if (!url) {
    logger.error('streamUrl is missing, could not create proxied URL');
    throw new Error('Stream URL is missing');
  }
  if (!mediaFlowConfig) {
    logger.error('mediaFlowConfig is missing');
    throw new Error('MediaFlow configuration is missing');
  }
  if (!mediaFlowConfig?.proxyUrl || !mediaFlowConfig?.apiPassword) {
    logger.error('mediaFlowUrl or API password is missing');
    throw new Error('MediaFlow URL or API password is missing');
  }

  const queryParams: Record<string, string> = {
    api_password: mediaFlowConfig.apiPassword,
  };
  queryParams.d = url;

  const responseHeaders = headers?.response || {
    'Content-Disposition': `attachment; filename=${path.basename(url)}`,
  };
  const requestHeaders = headers?.request || {};

  if (Settings.ENCRYPT_MEDIAFLOW_URLS) {
    const encryptedUrl = await encryptMediaFlowUrl(
      url,
      mediaFlowConfig,
      responseHeaders,
      requestHeaders
    );
    return encryptedUrl;
  }

  if (requestHeaders) {
    Object.entries(requestHeaders).forEach(([key, value]) => {
      queryParams[`h_${key}`] = value;
    });
  }

  if (responseHeaders) {
    Object.entries(responseHeaders).forEach(([key, value]) => {
      queryParams[`r_${key}`] = value;
    });
  }

  const encodedParams = new URLSearchParams(queryParams).toString();
  const proxiedUrl = new URL(mediaFlowConfig.proxyUrl.replace(/\/$/, ''));
  const proxyEndpoint = '/proxy/stream';
  proxiedUrl.pathname = `${proxiedUrl.pathname === '/' ? '' : proxiedUrl.pathname}${proxyEndpoint}`;
  proxiedUrl.search = encodedParams;
  return proxiedUrl.toString();
}

async function encryptMediaFlowUrl(
  url: string,
  mediaFlowConfig: Config['mediaFlowConfig'],
  responseHeaders: Record<string, string>,
  requestHeaders: Record<string, string>
) {
  if (!mediaFlowConfig) {
    throw new Error('MediaFlow configuration is missing');
  }
  const proxyUrl = new URL(mediaFlowConfig.proxyUrl.replace(/\/$/, ''));
  const generateEncryptedUrlEndpoint = '/generate_encrypted_or_encoded_url';
  proxyUrl.pathname = `${proxyUrl.pathname === '/' ? '' : proxyUrl.pathname}${generateEncryptedUrlEndpoint}`;

  const data = {
    mediaflow_proxy_url: mediaFlowConfig.proxyUrl.replace(/\/$/, ''),
    endpoint: '/proxy/stream',
    destination_url: url,
    request_headers: requestHeaders,
    response_headers: responseHeaders,
    expiration: 3600 * 24, // URL will expire in 24 hours
    api_password: mediaFlowConfig.apiPassword,
  };

  const response = await fetch(proxyUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(Settings.MEDIAFLOW_IP_TIMEOUT),
  });
  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }
  const responseData = await response.json();
  if (responseData.error) {
    throw new Error(responseData.error);
  }
  if (responseData.encoded_url) {
    return responseData.encoded_url;
  } else {
    throw new Error('No encrypted or encoded URL returned');
  }
}

export async function getMediaFlowPublicIp(
  mediaFlowConfig: Config['mediaFlowConfig'],
  cache: Cache<string, string>
) {
  try {
    if (!mediaFlowConfig) {
      logger.error('mediaFlowConfig is missing');
      throw new Error('MediaFlow configuration is missing');
    }

    if (!mediaFlowConfig?.proxyUrl) {
      logger.error('mediaFlowUrl is missing');
      throw new Error('MediaFlow URL is missing');
    }

    if (mediaFlowConfig.publicIp) {
      return mediaFlowConfig.publicIp;
    }

    const mediaFlowUrl = new URL(mediaFlowConfig.proxyUrl.replace(/\/$/, ''));
    if (PRIVATE_CIDR.test(mediaFlowUrl.hostname)) {
      // MediaFlow proxy URL is a private IP address
      logger.debug(
        'MediaFlow proxy URL is a private IP address so returning null'
      );
      return null;
    }

    const cacheKey = getTextHash(
      `mediaFlowPublicIp:${mediaFlowConfig.proxyUrl}:${mediaFlowConfig.apiPassword}`
    );
    const cachedPublicIp = cache ? cache.get(cacheKey) : null;
    if (cachedPublicIp) {
      logger.debug(`Returning cached public IP`);
      return cachedPublicIp;
    }

    const proxyIpUrl = mediaFlowUrl;
    const proxyIpPath = '/proxy/ip';
    proxyIpUrl.pathname = `${proxyIpUrl.pathname === '/' ? '' : proxyIpUrl.pathname}${proxyIpPath}`;
    proxyIpUrl.search = new URLSearchParams({
      api_password: mediaFlowConfig.apiPassword,
    }).toString();

    if (Settings.LOG_SENSITIVE_INFO) {
      logger.debug(`GET ${proxyIpUrl.toString()}`);
    } else {
      logger.debug('GET /proxy/ip?api_password=***');
    }

    const response = await fetch(proxyIpUrl.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(Settings.MEDIAFLOW_IP_TIMEOUT),
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const publicIp = data.ip;
    if (publicIp && cache) {
      cache.set(cacheKey, publicIp, Settings.CACHE_MEDIAFLOW_IP_TTL);
    }
    return publicIp;
  } catch (error: any) {
    logger.error(`${error.message}`);
    return null;
  }
}

export function getMediaFlowConfig(userConfig: Config) {
  const mediaFlowConfig = userConfig.mediaFlowConfig;

  return {
    mediaFlowEnabled:
      mediaFlowConfig?.mediaFlowEnabled ||
      Settings.DEFAULT_MEDIAFLOW_URL !== '',
    proxyUrl: mediaFlowConfig?.proxyUrl || Settings.DEFAULT_MEDIAFLOW_URL,
    apiPassword:
      mediaFlowConfig?.apiPassword || Settings.DEFAULT_MEDIAFLOW_API_PASSWORD,
    publicIp: mediaFlowConfig?.publicIp || Settings.DEFAULT_MEDIAFLOW_PUBLIC_IP,
    proxiedAddons: mediaFlowConfig?.proxiedAddons || null,
    proxiedServices: mediaFlowConfig?.proxiedServices || null,
  };
}
