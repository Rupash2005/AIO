import { ParsedNameData, ParseResult, StreamRequest } from '@aiostreams/types';
import { parseFilename } from '@aiostreams/parser';
import { ParsedStream, Stream, Config } from '@aiostreams/types';
import { BaseWrapper } from './base';
import { serviceDetails } from '@aiostreams/utils';
import { Settings } from '@aiostreams/utils';

export class EasynewsPlus extends BaseWrapper {
  constructor(
    configString: string | null,
    overrideUrl: string | null,
    addonName: string = 'Easynews+',
    addonId: string,
    userConfig: Config,
    indexerTimeout?: number
  ) {
    let url = overrideUrl
      ? overrideUrl
      : Settings.EASYNEWS_PLUS_URL + (configString ? configString + '/' : '');

    super(
      addonName,
      url,
      addonId,
      userConfig,
      indexerTimeout || Settings.DEFAULT_EASYNEWS_PLUS_TIMEMOUT
    );
  }

  protected parseStream(stream: Stream): ParseResult {
    const parseResult = super.parseStream(stream);
    if (parseResult.type !== 'error') {
      parseResult.result.type = 'usenet';
    }
    return parseResult;
  }
}

const getEasynewsPlusConfigString = (username: string, password: string) => {
  return `%7B%22username%22%3A%22${encodeURIComponent(username)}%22%2C%22password%22%3A%22${encodeURIComponent(password)}%22%2C%22sort1%22%3A%22Size%22%2C%22sort1Direction%22%3A%22Descending%22%2C%22sort2%22%3A%22Relevance%22%2C%22sort2Direction%22%3A%22Descending%22%2C%22sort3%22%3A%22Date%20%26%20Time%22%2C%22sort3Direction%22%3A%22Descending%22%7D`;
};

export async function getEasynewsPlusStreams(
  config: Config,
  easynewsPlusOptions: {
    overrideName?: string;
    overrideUrl?: string;
    indexerTimeout?: string;
  },
  streamRequest: StreamRequest,
  addonId: string
): Promise<{
  addonStreams: ParsedStream[];
  addonErrors: string[];
}> {
  // look for the 'easynews' id in the services array and destructure the username and password
  // if we cant find it, throw an error
  const easynewsService = serviceDetails.find(
    (service) => service.id === 'easynews'
  );
  if (!easynewsService) {
    throw new Error('Easynews service not found');
  }

  // check for the presence of the username and password in teh easynewsService.credentials object
  // if not found, throw an error
  const credentails = config.services.find(
    (service) => service.id === 'easynews'
  )?.credentials;
  if (!credentails || !credentails.username || !credentails.password) {
    throw new Error('Easynews credentials not found');
  }

  const easynewsPlusConfigString = getEasynewsPlusConfigString(
    credentails.username,
    credentails.password
  );

  const easynews = new EasynewsPlus(
    easynewsPlusConfigString,
    easynewsPlusOptions.overrideUrl ?? null,
    easynewsPlusOptions.overrideName,
    addonId,
    config,
    easynewsPlusOptions.indexerTimeout
      ? parseInt(easynewsPlusOptions.indexerTimeout)
      : undefined
  );

  return await easynews.getParsedStreams(streamRequest);
}
