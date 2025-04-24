import {
  Stream,
  ParsedStream,
  StreamRequest,
  ParsedNameData,
  Config,
  ErrorStream,
  ParseResult,
} from '@aiostreams/types';
import { parseFilename } from '@aiostreams/parser';
import {
  getTextHash,
  serviceDetails,
  Settings,
  createLogger,
} from '@aiostreams/utils';
import { emojiToLanguage, codeToLanguage } from '@aiostreams/formatters';

const logger = createLogger('wrappers');

export class BaseWrapper {
  private readonly streamPath: string = 'stream/{type}/{id}.json';
  private indexerTimeout: number;
  protected addonName: string;
  private addonUrl: string;
  private addonId: string;
  private userConfig: Config;
  constructor(
    addonName: string,
    addonUrl: string,
    addonId: string,
    userConfig: Config,
    indexerTimeout?: number
  ) {
    this.addonName = addonName;
    this.addonUrl = this.standardizeManifestUrl(addonUrl);
    this.addonId = addonId;
    (this.indexerTimeout = indexerTimeout || Settings.DEFAULT_TIMEOUT),
      (this.userConfig = userConfig);
  }

  protected standardizeManifestUrl(url: string): string {
    // remove trailing slash and replace stremio:// with https://
    let manifestUrl = url.replace('stremio://', 'https://').replace(/\/$/, '');
    return manifestUrl.endsWith('/manifest.json')
      ? manifestUrl
      : `${manifestUrl}/manifest.json`;
  }

  public async getParsedStreams(streamRequest: StreamRequest): Promise<{
    addonStreams: ParsedStream[];
    addonErrors: string[];
  }> {
    const streams: Stream[] = await this.getStreams(streamRequest);
    const errors: string[] = [];
    const finalStreams = streams
      .map((stream) => {
        const { type, result } = this.parseStream(stream);
        if (type === 'error') {
          errors.push(result);
          return undefined;
        } else if (type === 'stream') {
          return result;
        } else {
          return undefined;
        }
      })
      .filter((parsedStream) => parsedStream !== undefined);

    return { addonStreams: finalStreams, addonErrors: errors };
  }

  private getStreamUrl(streamRequest: StreamRequest) {
    return (
      this.addonUrl.replace('manifest.json', '') +
      this.streamPath
        .replace('{type}', streamRequest.type)
        .replace('{id}', encodeURIComponent(streamRequest.id))
    );
  }

  private shouldProxyRequest(url: string): boolean {
    let useProxy: boolean = false;
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch (e: any) {
      logger.error(`Error parsing URL: ${this.getLoggableUrl(url)}`, {
        func: 'shouldProxyRequest',
      });
      return false;
    }
    if (!Settings.ADDON_PROXY) {
      useProxy = false;
    } else if (Settings.ADDON_PROXY_CONFIG || Settings.ADDON_PROXY) {
      useProxy = true;
      if (Settings.ADDON_PROXY_CONFIG) {
        for (const rule of Settings.ADDON_PROXY_CONFIG.split(',')) {
          const [ruleHost, enabled] = rule.split(':');
          if (['true', 'false'].includes(enabled) === false) {
            logger.error(
              `Invalid rule: ${rule}. Rule must be in the format host:enabled`,
              {
                func: 'shouldProxyRequest',
              }
            );
            continue;
          }
          if (ruleHost === '*') {
            useProxy = !(enabled === 'false');
          } else if (ruleHost.startsWith('*')) {
            if (hostname.endsWith(ruleHost.slice(1))) {
              useProxy = !(enabled === 'false');
            }
          }
          if (hostname === ruleHost) {
            useProxy = !(enabled === 'false');
          }
        }
      }
    }
    return useProxy;
  }

  protected getLoggableUrl(url: string): string {
    let urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/');
    const redactedParts = pathParts.length > 3 ? pathParts.slice(1, -3) : [];
    return `${urlObj.protocol}//${urlObj.hostname}/${redactedParts
      .map((part) => (Settings.LOG_SENSITIVE_INFO ? part : '<redacted>'))
      .join(
        '/'
      )}${redactedParts.length ? '/' : ''}${pathParts.slice(-3).join('/')}`;
  }

  protected makeRequest(url: string): Promise<any> {
    const headers = new Headers();
    const userIp = this.userConfig.requestingIp;
    if (userIp) {
      headers.set('X-Client-IP', userIp);
      headers.set('X-Forwarded-For', userIp);
      headers.set('X-Real-IP', userIp);
    }

    let sanitisedUrl = this.getLoggableUrl(url);
    let useProxy = this.shouldProxyRequest(url);

    logger.info(
      `Making a ${useProxy ? 'proxied' : 'direct'} request to ${this.addonName} (${sanitisedUrl}) with user IP ${
        userIp
          ? Settings.LOG_SENSITIVE_INFO
            ? userIp
            : '<redacted>'
          : 'not set'
      }`
    );

    let response = useProxy
      ? fetch(url, {
          method: 'GET',
          headers: headers,
          signal: AbortSignal.timeout(this.indexerTimeout),
        })
      : fetch(url, {
          method: 'GET',
          headers: headers,
          signal: AbortSignal.timeout(this.indexerTimeout),
        });

    return response;
  }
  protected async getStreams(streamRequest: StreamRequest): Promise<Stream[]> {
    const url = this.getStreamUrl(streamRequest);
    const cache = this.userConfig.instanceCache;
    const requestCacheKey = getTextHash(url);
    const cachedStreams = cache ? cache.get(requestCacheKey) : undefined;
    if (cachedStreams) {
      logger.info(
        `Returning cached streams for ${this.addonName} (${this.getLoggableUrl(url)})`
      );
      return cachedStreams;
    }
    try {
      const response = await this.makeRequest(url);
      if (!response.ok) {
        const text = await response.text();
        let error = `${response.status} - ${response.statusText}`;
        try {
          error += ` with response: ${JSON.stringify(JSON.parse(text))}`;
        } catch {}
        throw new Error(error);
      }

      const results = (await response.json()) as { streams: Stream[] };
      if (!results.streams) {
        throw new Error('Failed to respond with streams');
      }
      if (Settings.CACHE_STREAM_RESULTS && cache) {
        cache.set(
          requestCacheKey,
          results.streams,
          Settings.CACHE_STREAM_RESULTS_TTL
        );
      }
      return results.streams;
    } catch (error: any) {
      let message = error.message;
      if (error.name === 'TimeoutError') {
        message = `The stream request to ${this.addonName} timed out after ${this.indexerTimeout}ms`;
        return Promise.reject(message);
      }
      const errorMessage = error.stack || String(error);
      logger.error(`Error fetching streams from ${this.addonName}`);
      logger.error(errorMessage);
      return Promise.reject(error.message);
    }
  }

  protected createParsedResult(
    parsedInfo: ParsedNameData,
    stream: Stream,
    filename?: string,
    size?: number,
    provider?: ParsedStream['provider'],
    seeders?: number,
    usenetAge?: string,
    indexer?: string,
    duration?: number,
    personal?: boolean,
    infoHash?: string,
    message?: string
  ): ParseResult {
    return {
      type: 'stream',
      result: {
        ...parsedInfo,
        message: message,
        addon: { name: this.addonName, id: this.addonId },
        filename: filename,
        size: size,
        url: stream.url,
        externalUrl: stream.externalUrl,
        _infoHash: infoHash,
        torrent: {
          infoHash: stream.infoHash,
          fileIdx: stream.fileIdx,
          sources: stream.sources,
          seeders: seeders,
        },
        provider: provider,
        usenet: {
          age: usenetAge,
        },
        indexers: indexer,
        duration: duration,
        personal: personal,
        type: stream.infoHash
          ? 'p2p'
          : usenetAge
            ? 'usenet'
            : provider
              ? 'debrid'
              : stream.url?.endsWith('.m3u8')
                ? 'live'
                : 'unknown',
        stream: {
          subtitles: stream.subtitles,
          behaviorHints: {
            countryWhitelist: stream.behaviorHints?.countryWhitelist,
            notWebReady: stream.behaviorHints?.notWebReady,
            proxyHeaders:
              stream.behaviorHints?.proxyHeaders?.request ||
              stream.behaviorHints?.proxyHeaders?.response
                ? {
                    request: stream.behaviorHints?.proxyHeaders?.request,
                    response: stream.behaviorHints?.proxyHeaders?.response,
                  }
                : undefined,
            videoHash: stream.behaviorHints?.videoHash,
          },
        },
      },
    };
  }
  protected parseStream(stream: { [key: string]: any }): ParseResult {
    // see if the stream is an error
    const errorRegex = /invalid\s+\w+\s+(account|apikey|token)/i;
    if (
      errorRegex.test(stream.title || '') ||
      errorRegex.test(stream.description || '')
    ) {
      logger.debug(
        `Result from ${this.addonName} (${(stream.title || stream.description).split('\n').join(' ')}) was detected as an error`
      );
      return {
        type: 'error',
        result: stream.title || stream.description,
      };
    }
    // attempt to look for filename in behaviorHints.filename
    let filename = stream?.behaviorHints?.filename || stream.filename;

    // if filename behaviorHint is not present, attempt to look for a filename in the stream description or title
    let description = stream.description || stream.title;
    const episodeRegex =
      /(?<![^ [_(\-.]])(?:s(?:eason)?[ .\-_]?(\d+)[ .\-_]?(?:e(?:pisode)?[ .\-_]?(\d+))?|(\d+)[xX](\d+))(?![^ \])_.-])/;
    const yearRegex = /(?<![^ [_(\-.])(\d{4})(?=[ \])_.-]|$)/i;
    if (!filename && description) {
      const lines = description.split('\n');
      filename =
        lines.find(
          (line: string) => line.match(episodeRegex) || line.match(yearRegex)
        ) || lines[0];
    }

    let stringToParse: string = filename || description || '';
    if (!(filename.match(episodeRegex) || filename.match(yearRegex))) {
      stringToParse = description.replace(/\n/g, ' ').trim();
    }
    let parsedInfo: ParsedNameData = parseFilename(stringToParse);

    // look for size in one of the many random places it could be
    let size: number | undefined;
    size =
      stream.behaviorHints?.videoSize ||
      stream.size ||
      stream.sizebytes ||
      stream.sizeBytes ||
      (description && this.extractSizeInBytes(description, 1024)) ||
      (stream.name && this.extractSizeInBytes(stream.name, 1024)) ||
      undefined;

    if (typeof size === 'string') {
      size = parseInt(size);
    }
    // look for seeders
    let seeders: string | undefined;
    if (description) {
      seeders = this.extractStringBetweenEmojis(['👥', '👤'], description);
    }

    // look for indexer
    let indexer: string | undefined;
    if (description) {
      indexer = this.extractStringBetweenEmojis(
        ['🌐', '⚙️', '🔗', '🔎', '☁️'],
        description
      );
    }

    [
      ...this.extractCountryFlags(description),
      ...this.extractCountryCodes(description),
    ]
      .map(
        (codeOrFlag) =>
          emojiToLanguage(codeOrFlag) || codeToLanguage(codeOrFlag)
      )
      .filter((lang) => lang !== undefined)
      .map((lang) =>
        lang
          .trim()
          .split(' ')
          .map(
            (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          )
          .join(' ')
      )
      .forEach((lang) => {
        if (lang && !parsedInfo.languages.includes(lang)) {
          parsedInfo.languages.push(lang);
        }
      });

    const resolution = this.extractResolution(stream.name || '');
    if (resolution && parsedInfo.resolution === 'Unknown') {
      parsedInfo.resolution = resolution;
    }
    const duration = stream.duration || this.extractDurationInMs(description);
    // look for providers
    let provider: ParsedStream['provider'] = this.parseServiceData(
      stream.name || ''
    );

    if (stream.infoHash && provider) {
      // if its a p2p result, it is not from a debrid service
      provider = undefined;
    }
    return this.createParsedResult(
      parsedInfo,
      stream,
      filename,
      size,
      provider,
      seeders ? parseInt(seeders) : undefined,
      undefined,
      indexer,
      duration,
      stream.personal,
      stream.infoHash || this.extractInfoHash(stream.url || '')
    );
  }

  protected parseServiceData(
    string: string
  ): ParsedStream['provider'] | undefined {
    const cleanString = string.replace(/web-?dl/i, '');
    const services = serviceDetails;
    const cachedSymbols = ['+', '⚡', '🚀', 'cached'];
    const uncachedSymbols = ['⏳', 'download', 'UNCACHED'];
    let provider: ParsedStream['provider'] | undefined;
    services.forEach((service) => {
      // for each service, generate a regexp which creates a regex with all known names separated by |
      const regex = new RegExp(
        `(^|(?<![^ |[(_\\/\\-.]))(${service.knownNames.join('|')})(?=[ ⬇️⏳⚡+/|\\)\\]_.-]|$)`,
        'i'
      );
      // check if the string contains the regex
      if (regex.test(cleanString)) {
        let cached: boolean = false;
        // check if any of the uncachedSymbols are in the string
        if (uncachedSymbols.some((symbol) => string.includes(symbol))) {
          cached = false;
        }
        // check if any of the cachedSymbols are in the string
        else if (cachedSymbols.some((symbol) => string.includes(symbol))) {
          cached = true;
        }

        provider = {
          id: service.id,
          cached: cached,
        };
      }
    });
    return provider;
  }

  protected extractResolution(string: string): string | undefined {
    const resolutionPattern = /(?:\d{3,4}(?:p)?|SD|HD|FHD|UHD|4K|8K)/gi;
    const match = string.match(resolutionPattern);

    if (!match) return undefined;
    return (
      match
        .map((resolution) => {
          switch (resolution) {
            case '480':
            case 'SD':
              return '480p';
            case '720':
            case 'HD':
              return '720p';
            case '1080':
            case '960':
            case 'FHD':
              return '1080p';
            case 'UHD':
            case '4K':
            case '2160':
              return '2160p';
            default:
              return 'Unknown';
          }
        })
        .find((res) => res !== 'Unknown') || 'Unknown'
    );
  }

  protected extractSizeInBytes(string: string, k: number): number {
    const sizePattern = /(\d+(\.\d+)?)\s?(KB|MB|GB)/i;
    const match = string.match(sizePattern);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[3];

    switch (unit.toUpperCase()) {
      case 'TB':
        return value * k * k * k * k;
      case 'GB':
        return value * k * k * k;
      case 'MB':
        return value * k * k;
      case 'KB':
        return value * k;
      default:
        return 0;
    }
  }

  protected extractDurationInMs(input: string): number {
    // Regular expression to match different formats of time durations
    const regex =
      /(?<![^\s\[(_\-,.])(?:(\d+)h[:\s]?(\d+)m[:\s]?(\d+)s|(\d+)h[:\s]?(\d+)m|(\d+)h|(\d+)m|(\d+)s)(?=[\s\)\]_.\-,]|$)/gi;

    const match = regex.exec(input);
    if (!match) {
      return 0;
    }

    const hours = parseInt(match[1] || match[4] || match[6] || '0', 10);
    const minutes = parseInt(match[2] || match[5] || match[7] || '0', 10);
    const seconds = parseInt(match[3] || match[8] || '0', 10);

    // Convert to milliseconds
    const totalMilliseconds = (hours * 3600 + minutes * 60 + seconds) * 1000;

    return totalMilliseconds;
  }

  protected extractStringBetweenEmojis(
    startingEmojis: string[],
    string: string,
    endingEmojis?: string[]
  ): string | undefined {
    const emojiPattern = /[\p{Emoji_Presentation}]/u;
    const startPattern = new RegExp(`(${startingEmojis.join('|')})`, 'u');
    const endPattern = endingEmojis
      ? new RegExp(`(${endingEmojis.join('|')}|$|\n)`, 'u')
      : new RegExp(`(${emojiPattern.source}|$|\n)`, 'u');

    const startMatch = string.match(startPattern);
    if (!startMatch) return undefined;

    const startIndex = startMatch.index! + startMatch[0].length;
    const remainingString = string.slice(startIndex);

    const endMatch = remainingString.match(endPattern);
    const endIndex = endMatch ? endMatch.index! : remainingString.length;

    return remainingString.slice(0, endIndex).trim();
  }

  protected extractStringAfter(
    startingPattern: string,
    string: string,
    endingPattern?: string
  ) {
    const startPattern = new RegExp(startingPattern, 'u');
    const endPattern = endingPattern
      ? new RegExp(endingPattern, 'u')
      : new RegExp(/$/u);

    const startMatch = string.match(startPattern);
    if (!startMatch) return undefined;

    const startIndex = startMatch.index! + startMatch[0].length;
    const remainingString = string.slice(startIndex);

    const endMatch = remainingString.match(endPattern);
    const endIndex = endMatch ? endMatch.index! : remainingString.length;

    return remainingString.slice(0, endIndex).trim();
  }

  protected extractCountryFlags(string: string): string[] {
    const countryFlagPattern = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
    const matches = string.match(countryFlagPattern);
    return matches ? [...new Set(matches)] : [];
  }

  protected extractCountryCodes(string: string): string[] {
    // only consider text after the movie/show title
    const episodeRegex =
      /(?<![^ [_(\-.]])(?:s(?:eason)?[ .\-_]?(\d+)[ .\-_]?(?:e(?:pisode)?[ .\-_]?(\d+))?|(\d+)x(\d+))(?![^ \])_.-])/i;
    const yearRegex = /(?<![^ [_(\-.])(\d{4})(?=[ \])_.-]|$)/i;

    const episodeMatch = string.match(episodeRegex);
    const yearMatch = string.match(yearRegex);
    if (episodeMatch && episodeMatch.index) {
      string = string.slice(episodeMatch.index + episodeMatch[0].length);
    } else if (yearMatch) {
      string = string.slice(yearMatch.index! + yearMatch[0].length);
    }
    const countryCodePattern = /\b(?!AC|DV)[A-Z]{2}\b/g;
    const matches = string.match(countryCodePattern);
    return matches ? [...new Set(matches)] : [];
  }

  protected extractInfoHash(url: string): string | undefined {
    return url.match(/(?<=[-/[(;:&])[a-fA-F0-9]{40}(?=[-\]\)/:;&])/)?.[0];
  }
}
