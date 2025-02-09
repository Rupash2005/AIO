import { AddonDetail, ParseResult, StreamRequest } from '@aiostreams/types';
import { ParsedStream, Stream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import {
  addonDetails,
  getTextHash,
  getTimeTakenSincePoint,
  Settings,
} from '@aiostreams/utils';

export class MediaFusion extends BaseWrapper {
  constructor(
    configString: string | null,
    overrideUrl: string | null,
    addonName: string = 'MediaFusion',
    addonId: string,
    userConfig: Config,
    indexerTimeout?: number
  ) {
    let url = overrideUrl
      ? overrideUrl
      : Settings.MEDIAFUSION_URL + (configString ? configString + '/' : '');

    super(
      addonName,
      url,
      addonId,
      userConfig,
      indexerTimeout || Settings.DEFAULT_MEDIAFUSION_TIMEOUT
    );
  }

  protected parseStream(stream: Stream): ParseResult {
    if (stream.description?.includes('Content Warning')) {
      return {
        type: 'error',
        result: stream.description,
      };
    }
    return super.parseStream(stream);
  }
}

export async function getMediafusionStreams(
  config: Config,
  mediafusionOptions: {
    prioritiseDebrid?: string;
    overrideUrl?: string;
    indexerTimeout?: string;
    overrideName?: string;
    filterCertificationLevels?: string;
    filterNudity?: string;
    liveSearchStreams?: string;
  },
  streamRequest: StreamRequest,
  addonId: string
): Promise<{
  addonStreams: ParsedStream[];
  addonErrors: string[];
}> {
  const supportedServices: string[] =
    addonDetails.find((addon: AddonDetail) => addon.id === 'mediafusion')
      ?.supportedServices || [];
  const addonStreams: ParsedStream[] = [];
  const indexerTimeout = mediafusionOptions.indexerTimeout
    ? parseInt(mediafusionOptions.indexerTimeout)
    : undefined;
  const liveSearchStreams =
    mediafusionOptions.liveSearchStreams === 'true' ? true : false;
  const cache = config.instanceCache;

  const getConfigString = async (data: any): Promise<string> => {
    const startTime = Date.now();
    const cacheKey = getTextHash(`mediafusionConfig:${JSON.stringify(data)}`);
    const cachedConfig = cache ? cache.get(cacheKey) : null;
    if (cachedConfig) {
      console.log(
        `|DBG| wrappers > mediafusion: Returning cached config string`
      );
      return cachedConfig;
    }
    try {
      const encryptedStr = await _getConfigString(data);

      console.log(
        `|INF| wrappers > mediafusion: Config encryption took ${getTimeTakenSincePoint(startTime)}`
      );
      cache?.set(cacheKey, encryptedStr, Settings.CACHE_MEDIAFUSION_CONFIG_TTL);
      return encryptedStr;
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        throw new Error(
          `Config encryption timed out after ${getTimeTakenSincePoint(
            startTime
          )}`
        );
      }
      throw new Error(`Failed to get config string: ${error.message}`);
    }
  };

  // If overrideUrl is provided, use it to get streams and skip all other steps
  if (mediafusionOptions.overrideUrl) {
    const mediafusion = new MediaFusion(
      null,
      mediafusionOptions.overrideUrl as string,
      mediafusionOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );
    return mediafusion.getParsedStreams(streamRequest);
  }

  // find all usable and enabled services
  const usableServices = config.services.filter(
    (service) => supportedServices.includes(service.id) && service.enabled
  );

  // if no usable services found, use mediafusion without debrid
  if (usableServices.length < 1) {
    const configString = await getConfigString(
      getMediaFusionConfig(
        mediafusionOptions.filterCertificationLevels,
        mediafusionOptions.filterNudity,
        liveSearchStreams
      )
    );
    const mediafusion = new MediaFusion(
      configString,
      null,
      mediafusionOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );
    return await mediafusion.getParsedStreams(streamRequest);
  }

  // otherwise, depending on the configuration, create multiple instances of mediafusion or use a single instance with the prioritised service

  if (
    mediafusionOptions.prioritiseDebrid &&
    !supportedServices.includes(mediafusionOptions.prioritiseDebrid)
  ) {
    throw new Error(
      `The service ${mediafusionOptions.prioritiseDebrid} is invalid for MediaFusion`
    );
  }

  if (mediafusionOptions.prioritiseDebrid) {
    const debridService = usableServices.find(
      (service) => service.id === mediafusionOptions.prioritiseDebrid
    );
    if (!debridService) {
      throw new Error(
        `${mediafusionOptions.prioritiseDebrid} could not be found in your services`
      );
    }
    if (!debridService.credentials.apiKey) {
      throw new Error(
        `Missing API key for ${mediafusionOptions.prioritiseDebrid}`
      );
    }

    // get the encrypted mediafusion string
    const mediafusionConfig = getMediaFusionConfig(
      mediafusionOptions.filterCertificationLevels,
      mediafusionOptions.filterNudity,
      liveSearchStreams,
      debridService.id,
      debridService.credentials
    );
    const encryptedStr = await getConfigString(mediafusionConfig);
    const mediafusion = new MediaFusion(
      encryptedStr,
      null,
      mediafusionOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );

    return await mediafusion.getParsedStreams(streamRequest);
  }

  // if no prioritised service is provided, create a mediafusion instance for each service
  const addonErrors: string[] = [];
  const servicesToUse = usableServices.filter((service) => service.enabled);
  if (servicesToUse.length < 1) {
    throw new Error(`No enabled services found for MediaFusion`);
  }
  const promises = servicesToUse.map(async (service) => {
    const mediafusionConfig = getMediaFusionConfig(
      mediafusionOptions.filterCertificationLevels,
      mediafusionOptions.filterNudity,
      liveSearchStreams,
      service.id,
      service.credentials
    );
    console.log(
      `|INF| wrappers > mediafusion: Getting MediaFusion streams for service: ${service.id}`
    );
    let encryptedStr: string = '';
    try {
      encryptedStr = await getConfigString(mediafusionConfig);
      if (!encryptedStr) {
        throw new Error(
          'An unknown error occurred while getting config string'
        );
      }
    } catch (error: any) {
      console.error(`|ERR| wrappers > mediafusion: ${error.message}`);
      throw new Error(error.message);
    }
    const mediafusion = new MediaFusion(
      encryptedStr,
      null,
      mediafusionOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );
    return mediafusion.getParsedStreams(streamRequest);
  });

  const results = await Promise.allSettled(promises);
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      addonStreams.push(...result.value.addonStreams);
      addonErrors.push(...result.value.addonErrors);
    } else {
      addonErrors.push(result.reason.message);
    }
  });

  return {
    addonStreams,
    addonErrors,
  };
}

const getMediaFusionConfig = (
  filterCertificationLevels?: string,
  filterNudity?: string,
  liveSearchStreams: boolean = false,
  service?: string,
  credentials: { [key: string]: string } = {}
): any => {
  let nudityFilter = ['Disable'];
  let certificationFilter = ['Disable'];
  if (filterCertificationLevels) {
    const levels = filterCertificationLevels.split(',');
    certificationFilter = levels.map((level) => level.trim());
  }
  if (filterNudity) {
    const levels = filterNudity.split(',');
    nudityFilter = levels.map((level) => level.trim());
  }
  return {
    streaming_provider: service
      ? {
          token: !['pikpak'].includes(service) ? credentials.apiKey : undefined,
          email: credentials.email,
          password: credentials.password,
          service: service,
          enable_watchlists_catalogs: false,
          download_via_browser: false,
          only_show_cached_streams: false,
        }
      : null,
    selected_catalogs: [],
    selected_resolutions: [
      '4k',
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '576p',
      '480p',
      '360p',
      '240p',
      null,
    ],
    enable_catalogs: true,
    enable_imdb_metadata: false,
    max_size: 'inf',
    max_streams_per_resolution: '500',
    torrent_sorting_priority: [
      { key: 'language', direction: 'desc' },
      { key: 'cached', direction: 'desc' },
      { key: 'resolution', direction: 'desc' },
      { key: 'quality', direction: 'desc' },
      { key: 'size', direction: 'desc' },
      { key: 'seeders', direction: 'desc' },
      { key: 'created_at', direction: 'desc' },
    ],
    show_full_torrent_name: true,
    show_language_country_flag: true,
    nudity_filter: nudityFilter,
    certification_filter: certificationFilter,
    language_sorting: [
      'English',
      'Tamil',
      'Hindi',
      'Malayalam',
      'Kannada',
      'Telugu',
      'Chinese',
      'Russian',
      'Arabic',
      'Japanese',
      'Korean',
      'Taiwanese',
      'Latino',
      'French',
      'Spanish',
      'Portuguese',
      'Italian',
      'German',
      'Ukrainian',
      'Polish',
      'Czech',
      'Thai',
      'Indonesian',
      'Vietnamese',
      'Dutch',
      'Bengali',
      'Turkish',
      'Greek',
      'Swedish',
      null,
    ],
    quality_filter: [
      'BluRay/UHD',
      'WEB/HD',
      'DVD/TV/SAT',
      'CAM/Screener',
      'Unknown',
    ],
    api_password: Settings.MEDIAFUSION_API_PASSWORD || null,
    mediaflow_config: null,
    rpdb_config: null,
    live_search_streams: liveSearchStreams,
    contribution_streams: false,
    mdblist_config: null,
  };
};

async function _getConfigString(data: any): Promise<string> {
  const encryptUrl = `${Settings.MEDIAFUSION_URL}encrypt-user-data`;
  const response = await fetch(encryptUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(
      Settings.MEDIAFUSION_CONFIG_TIMEOUT ||
        Settings.DEFAULT_MEDIAFUSION_TIMEOUT ||
        Settings.DEFAULT_TIMEOUT
    ),
  });

  const encryptedData = await response.json();
  if (encryptedData.status !== 'success') {
    throw new Error(
      `Config encryption failed: ${encryptedData.message || 'Unknown error'}`
    );
  }
  return encryptedData.encrypted_str;
}
