import { AddonDetail, ParseResult, StreamRequest } from '@aiostreams/types';
import { ParsedStream, Stream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import { addonDetails } from '@aiostreams/utils';
import { Settings } from '@aiostreams/utils';

export class Comet extends BaseWrapper {
  constructor(
    configString: string | null,
    overrideUrl: string | null,
    addonName: string = 'Comet',
    addonId: string,
    userConfig: Config,
    indexerTimeout?: number
  ) {
    let url = overrideUrl
      ? overrideUrl
      : Settings.COMET_URL + (configString ? configString + '/' : '');

    super(
      addonName,
      url,
      addonId,
      userConfig,
      indexerTimeout || Settings.DEFAULT_COMET_TIMEOUT
    );
  }

  protected parseStream(stream: Stream): ParseResult {
    const parsedStream = super.parseStream(stream);
    if (stream.url && parsedStream.type === 'stream') {
      parsedStream.result.filename = stream.description?.split('\n')[0];
      // force COMET_FORCE_HOSTNAME if provided
      if (Settings.FORCE_COMET_HOSTNAME) {
        const url = new URL(stream.url);
        url.hostname = Settings.FORCE_COMET_HOSTNAME;
        url.port = Settings.FORCE_COMET_PORT;
        url.protocol = Settings.FORCE_COMET_PROTOCOL;
        parsedStream.result.url = url.toString();
      }
    }
    return parsedStream;
  }
}

const getCometConfig = (debridService: string, debridApiKey: string) => {
  return {
    indexers: Settings.COMET_INDEXERS,
    maxResults: 0,
    maxResultsPerResolution: 0,
    maxSize: 0,
    reverseResultOrder: false,
    removeTrash: true,
    resultFormat: ['All'],
    resolutions: ['All'],
    languages: ['All'],
    debridService: debridService,
    debridApiKey: debridApiKey,
    stremthruUrl: '',
    debridStreamProxyPassword: '',
  };
};

export async function getCometStreams(
  config: Config,
  cometOptions: {
    prioritiseDebrid?: string;
    overrideUrl?: string;
    indexerTimeout?: string;
    overrideName?: string;
  },
  streamRequest: StreamRequest,
  addonId: string
): Promise<{
  addonStreams: ParsedStream[];
  addonErrors: string[];
}> {
  const supportedServices: string[] =
    addonDetails.find((addon: AddonDetail) => addon.id === 'comet')
      ?.supportedServices || [];
  const parsedStreams: ParsedStream[] = [];
  const indexerTimeout = cometOptions.indexerTimeout
    ? parseInt(cometOptions.indexerTimeout)
    : undefined;

  // If overrideUrl is provided, use it to get streams and skip all other steps
  if (cometOptions.overrideUrl) {
    const comet = new Comet(
      null,
      cometOptions.overrideUrl as string,
      cometOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );
    return await comet.getParsedStreams(streamRequest);
  }

  // find all usable and enabled services
  const usableServices = config.services.filter(
    (service) => supportedServices.includes(service.id) && service.enabled
  );

  // if no usable services found, throw an error
  if (usableServices.length < 1) {
    throw new Error('No supported service(s) enabled');
  }

  // otherwise, depending on the configuration, create multiple instances of comet or use a single instance with the prioritised service

  if (
    cometOptions.prioritiseDebrid &&
    !supportedServices.includes(cometOptions.prioritiseDebrid)
  ) {
    throw new Error('Invalid debrid service');
  }

  if (cometOptions.prioritiseDebrid) {
    const debridService = usableServices.find(
      (service) => service.id === cometOptions.prioritiseDebrid
    );
    if (!debridService) {
      throw new Error(
        'Debrid service not found for ' + cometOptions.prioritiseDebrid
      );
    }
    if (!debridService.credentials.apiKey) {
      throw new Error(
        'Debrid service API key not found for ' + cometOptions.prioritiseDebrid
      );
    }

    // get the comet config and b64 encode it
    const cometConfig = getCometConfig(
      cometOptions.prioritiseDebrid,
      debridService.credentials.apiKey
    );
    const configString = Buffer.from(JSON.stringify(cometConfig)).toString(
      'base64'
    );
    const comet = new Comet(
      configString,
      null,
      cometOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );

    return await comet.getParsedStreams(streamRequest);
  }

  // if no prioritised service is provided, create a comet instance for each service
  const servicesToUse = usableServices.filter((service) => service.enabled);
  if (servicesToUse.length < 1) {
    throw new Error('No supported service(s) enabled');
  }
  const errorMessages: string[] = [];
  const streamPromises = servicesToUse.map(async (service) => {
    console.log(
      `|INF| wrappers > comet: Getting Comet streams for service: ${service.id}`
    );
    const cometConfig = getCometConfig(service.id, service.credentials.apiKey);
    const configString = Buffer.from(JSON.stringify(cometConfig)).toString(
      'base64'
    );
    const comet = new Comet(
      configString,
      null,
      cometOptions.overrideName,
      addonId,
      config,
      indexerTimeout
    );
    return comet.getParsedStreams(streamRequest);
  });

  const results = await Promise.allSettled(streamPromises);
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      const streams = result.value;
      parsedStreams.push(...streams.addonStreams);
      errorMessages.push(...streams.addonErrors);
    } else {
      errorMessages.push(result.reason.message);
    }
  });

  return { addonStreams: parsedStreams, addonErrors: errorMessages };
}
