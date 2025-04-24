import {
  BaseWrapper,
  getCometStreams,
  getDebridioStreams,
  getDMMCastStreams,
  getEasynewsPlusStreams,
  getEasynewsStreams,
  getJackettioStreams,
  getMediafusionStreams,
  getOrionStreams,
  getPeerflixStreams,
  getStremioJackettStreams,
  getTorboxStreams,
  getTorrentioStreams,
} from '@aiostreams/wrappers';
import {
  Stream,
  ParsedStream,
  StreamRequest,
  Config,
  ErrorStream,
} from '@aiostreams/types';
import {
  gdriveFormat,
  torrentioFormat,
  torboxFormat,
  imposterFormat,
} from '@aiostreams/formatters';
import {
  addonDetails,
  createProxiedMediaFlowUrl,
  getMediaFlowConfig,
  getMediaFlowPublicIp,
  getTimeTakenSincePoint,
  Settings,
  createLogger,
} from '@aiostreams/utils';
import { errorStream } from './responses';

const logger = createLogger('addon');

export class AIOStreams {
  private config: Config;

  constructor(config: any) {
    this.config = config;
  }

  private async getRequestingIp() {
    let userIp = this.config.requestingIp;
    if (userIp === '::1') {
      userIp = undefined;
    }
    const mediaFlowConfig = getMediaFlowConfig(this.config);
    if (mediaFlowConfig.mediaFlowEnabled) {
      const mediaFlowIp = await getMediaFlowPublicIp(
        mediaFlowConfig,
        this.config.instanceCache
      );
      if (mediaFlowIp) {
        userIp = mediaFlowIp;
      }
    }
    return userIp;
  }

  public async getStreams(streamRequest: StreamRequest): Promise<Stream[]> {
    const streams: Stream[] = [];
    const startTime = new Date().getTime();

    let ipRequestCount = 0;
    while (ipRequestCount < 3) {
      try {
        const ip = await this.getRequestingIp();
        if (!ip && getMediaFlowConfig(this.config).mediaFlowEnabled) {
          throw new Error('No IP was found with MediaFlow enabled');
        }
        this.config.requestingIp = ip;
        break;
      } catch (error: any) {
        logger.error(error, {
          func: 'getRequestingIp',
        });
        ipRequestCount++;
        if (ipRequestCount < 3) {
          logger.info(`Retrying ${ipRequestCount}/3...`);
        }
      }
    }
    if (ipRequestCount === 3) {
      logger.error('Failed to get requesting IP after 3 attempts');
      if (this.config.mediaFlowConfig?.mediaFlowEnabled) {
        return [
          errorStream('Aborted request after failing to get requesting IP'),
        ];
      }
    }
    const { parsedStreams, errorStreams } =
      await this.getParsedStreams(streamRequest);

    const skipReasons = {
      excludeKeywords: 0,
      requiredKeywords: 0,
      excludeLanguages: 0,
      excludeResolutions: 0,
      excludeQualities: 0,
      excludeEncodes: 0,
      excludeAudioTags: 0,
      excludeVisualTags: 0,
      excludeStreamTypes: 0,
      excludeCached: 0,
      sizeFilters: 0,
      duplicateStreams: 0,
      streamLimiters: 0,
    };

    logger.info(
      `Got ${parsedStreams.length} parsed streams and ${errorStreams.length} error streams in ${getTimeTakenSincePoint(startTime)}`
    );
    const filterStartTime = new Date().getTime();

    const excludeRegex = this.config.excludeFilters
      ? new RegExp(
          `(?<![^ [(_\\-.])(${this.config.excludeFilters
            .map((filter) => filter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'))
            .map((filter) => filter.replace(/\s/g, '[ .\\-_]?'))
            .join('|')})(?=[ \\)\\]_.-]|$)`,
          'i'
        )
      : null;

    const strictIncludeRegex = this.config.strictIncludeFilters
      ? new RegExp(
          `(?<![^ [(_\\-.])(${this.config.strictIncludeFilters
            .map((filter) => filter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'))
            .map((filter) => filter.replace(/\s/g, '[ .\\-_]?'))
            .join('|')})(?=[ \\)\\]_.-]|$)`,
          'i'
        )
      : null;

    excludeRegex || strictIncludeRegex
      ? logger.debug(
          `Using keyword regex filters: excludeRegex: ${excludeRegex}, strictIncludeRegex: ${strictIncludeRegex}`
        )
      : null;

    let filteredResults = parsedStreams.filter((parsedStream) => {
      const streamTypeFilter = this.config.streamTypes?.find(
        (streamType) => streamType[parsedStream.type] === false
      );
      if (this.config.streamTypes && streamTypeFilter) {
        skipReasons.excludeStreamTypes++;
        return false;
      }

      const resolutionFilter = this.config.resolutions?.find(
        (resolution) => resolution[parsedStream.resolution] === false
      );
      if (resolutionFilter) {
        skipReasons.excludeResolutions++;
        return false;
      }

      const qualityFilter = this.config.qualities?.find(
        (quality) => quality[parsedStream.quality] === false
      );
      if (this.config.qualities && qualityFilter) {
        skipReasons.excludeQualities++;
        return false;
      }

      // Check for HDR and DV tags in the parsed stream
      const hasHDR = parsedStream.visualTags.some((tag) =>
        tag.startsWith('HDR')
      );
      const hasDV = parsedStream.visualTags.includes('DV');
      const hasHDRAndDV = hasHDR && hasDV;
      const HDRAndDVEnabled = this.config.visualTags.some(
        (visualTag) => visualTag['HDR+DV'] === true
      );

      const isTagDisabled = (tag: string) =>
        this.config.visualTags.some((visualTag) => visualTag[tag] === false);

      if (hasHDRAndDV) {
        if (!HDRAndDVEnabled) {
          skipReasons.excludeVisualTags++;
          return false;
        }
      } else if (hasHDR) {
        const specificHdrTags = parsedStream.visualTags.filter((tag) =>
          tag.startsWith('HDR')
        );
        const disabledTags = specificHdrTags.filter(
          (tag) => isTagDisabled(tag) === true
        );
        if (disabledTags.length > 0) {
          skipReasons.excludeVisualTags++;
          return;
        }
      } else if (hasDV && isTagDisabled('DV')) {
        skipReasons.excludeVisualTags++;
        return false;
      }

      // Check other visual tags for explicit disabling
      for (const tag of parsedStream.visualTags) {
        if (tag.startsWith('HDR') || tag === 'DV') continue;
        if (isTagDisabled(tag)) {
          skipReasons.excludeVisualTags++;
          return false;
        }
      }

      // apply excludedLanguages filter
      const excludedLanguages = this.config.excludedLanguages;
      if (excludedLanguages && parsedStream.languages.length > 0) {
        if (
          parsedStream.languages.every((lang) =>
            excludedLanguages.includes(lang)
          )
        ) {
          skipReasons.excludeLanguages++;
          return false;
        }
      } else if (
        excludedLanguages &&
        excludedLanguages.includes('Unknown') &&
        parsedStream.languages.length === 0
      ) {
        skipReasons.excludeLanguages++;
        return false;
      }

      const audioTagFilter = parsedStream.audioTags.find((tag) =>
        this.config.audioTags.some((audioTag) => audioTag[tag] === false)
      );
      if (audioTagFilter) {
        skipReasons.excludeAudioTags++;
        return false;
      }

      if (
        parsedStream.encode &&
        this.config.encodes.some(
          (encode) => encode[parsedStream.encode] === false
        )
      ) {
        skipReasons.excludeEncodes++;
        return false;
      }

      if (
        this.config.onlyShowCachedStreams &&
        parsedStream.provider &&
        !parsedStream.provider.cached
      ) {
        skipReasons.excludeCached++;
        return false;
      }

      if (
        this.config.minSize &&
        parsedStream.size &&
        parsedStream.size < this.config.minSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      if (
        this.config.maxSize &&
        parsedStream.size &&
        parsedStream.size > this.config.maxSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      if (
        streamRequest.type === 'movie' &&
        this.config.maxMovieSize &&
        parsedStream.size &&
        parsedStream.size > this.config.maxMovieSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      if (
        streamRequest.type === 'movie' &&
        this.config.minMovieSize &&
        parsedStream.size &&
        parsedStream.size < this.config.minMovieSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      if (
        streamRequest.type === 'series' &&
        this.config.maxEpisodeSize &&
        parsedStream.size &&
        parsedStream.size > this.config.maxEpisodeSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      if (
        streamRequest.type === 'series' &&
        this.config.minEpisodeSize &&
        parsedStream.size &&
        parsedStream.size < this.config.minEpisodeSize
      ) {
        skipReasons.sizeFilters++;
        return false;
      }

      // apply keyword filters
      if (
        this.config.excludeFilters &&
        this.config.excludeFilters.length > 0 &&
        excludeRegex
      ) {
        if (parsedStream.filename && excludeRegex.test(parsedStream.filename)) {
          skipReasons.excludeKeywords++;
          return false;
        }
        if (parsedStream.indexers && excludeRegex.test(parsedStream.indexers)) {
          skipReasons.excludeKeywords++;
          return false;
        }
      }

      if (
        this.config.strictIncludeFilters &&
        this.config.strictIncludeFilters.length > 0 &&
        strictIncludeRegex
      ) {
        if (
          parsedStream.filename &&
          !strictIncludeRegex.test(parsedStream.filename)
        ) {
          skipReasons.requiredKeywords++;
          return false;
        }
      }
      return true;
    });

    logger.info(
      `Initial filter to ${filteredResults.length} streams in ${getTimeTakenSincePoint(filterStartTime)}`
    );

    if (this.config.cleanResults) {
      const cleanedStreams: ParsedStream[] = [];
      const initialStreams = filteredResults;
      const normaliseFilename = (filename?: string): string | undefined =>
        filename
          ? filename
              ?.replace(
                /\.(mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|3gp|3g2|m2ts|ts|vob|ogv|ogm|divx|xvid|rm|rmvb|asf|mxf|mka|mks|mk3d|webm|f4v|f4p|f4a|f4b)$/i,
                ''
              )
              .replace(/[^\p{L}\p{N}+]/gu, '')
              .replace(/\s+/g, '')
              .toLowerCase()
          : undefined;

      const groupStreamsByKey = (
        streams: ParsedStream[],
        keyExtractor: (stream: ParsedStream) => string | undefined
      ): Record<string, ParsedStream[]> => {
        return streams.reduce(
          (acc, stream) => {
            const key = keyExtractor(stream);
            if (!key) {
              if (!cleanedStreams.includes(stream)) {
                cleanedStreams.push(stream);
              }
              return acc;
            }
            acc[key] = acc[key] || [];
            acc[key].push(stream);
            return acc;
          },
          {} as Record<string, ParsedStream[]>
        );
      };

      const cleanResultsStartTime = new Date().getTime();
      // Deduplication by normalised filename
      const cleanResultsByFilenameStartTime = new Date().getTime();
      logger.info(`Received ${initialStreams.length} streams to clean`);
      const streamsGroupedByFilename = groupStreamsByKey(
        initialStreams,
        (stream) => normaliseFilename(stream.filename)
      );

      logger.info(
        `Found ${Object.keys(streamsGroupedByFilename).length} unique filenames with ${
          initialStreams.length -
          Object.values(streamsGroupedByFilename).reduce(
            (sum, group) => sum + group.length,
            0
          )
        } streams not grouped`
      );

      // Process grouped streams by filename
      const cleanedStreamsByFilename = await this.processGroupedStreams(
        streamsGroupedByFilename
      );

      logger.info(
        `Deduplicated streams by filename to ${cleanedStreamsByFilename.length} streams in ${getTimeTakenSincePoint(cleanResultsByFilenameStartTime)}`
      );

      // Deduplication by hash
      const cleanResultsByHashStartTime = new Date().getTime();

      const streamsGroupedByHash = groupStreamsByKey(
        cleanedStreamsByFilename,
        (stream) => stream._infoHash
      );
      logger.info(
        `Found ${Object.keys(streamsGroupedByHash).length} unique hashes with ${cleanedStreamsByFilename.length - Object.values(streamsGroupedByHash).reduce((sum, group) => sum + group.length, 0)} streams not grouped`
      );

      // Process grouped streams by hash
      const cleanedStreamsByHash =
        await this.processGroupedStreams(streamsGroupedByHash);

      logger.info(
        `Deduplicated streams by hash to ${cleanedStreamsByHash.length} streams in ${getTimeTakenSincePoint(cleanResultsByHashStartTime)}`
      );

      cleanedStreams.push(...cleanedStreamsByHash);
      logger.info(
        `Deduplicated streams to ${cleanedStreams.length} streams in ${getTimeTakenSincePoint(cleanResultsStartTime)}`
      );
      skipReasons.duplicateStreams =
        filteredResults.length - cleanedStreams.length;
      filteredResults = cleanedStreams;
    }
    // Apply sorting
    const sortStartTime = new Date().getTime();
    // initially sort by filename to ensure consistent results
    filteredResults.sort((a, b) =>
      a.filename && b.filename ? a.filename.localeCompare(b.filename) : 0
    );

    // then apply our this.config sorting
    filteredResults.sort((a, b) => {
      for (const sortByField of this.config.sortBy) {
        const field = Object.keys(sortByField).find(
          (key) => typeof sortByField[key] === 'boolean'
        );
        if (!field) continue;
        const value = sortByField[field];

        if (value) {
          const fieldComparison = this.compareByField(a, b, field);
          if (fieldComparison !== 0) return fieldComparison;
        }
      }

      return 0;
    });

    logger.info(`Sorted results in ${getTimeTakenSincePoint(sortStartTime)}`);

    // apply config.maxResultsPerResolution
    if (this.config.maxResultsPerResolution) {
      const startTime = new Date().getTime();
      const resolutionCounts = new Map();

      const limitedResults = filteredResults.filter((result) => {
        const resolution = result.resolution || 'Unknown';
        const currentCount = resolutionCounts.get(resolution) || 0;

        if (currentCount < this.config.maxResultsPerResolution!) {
          resolutionCounts.set(resolution, currentCount + 1);
          return true;
        }

        return false;
      });
      skipReasons.streamLimiters =
        filteredResults.length - limitedResults.length;
      filteredResults = limitedResults;

      logger.info(
        `Limited results to ${limitedResults.length} streams after applying maxResultsPerResolution in ${new Date().getTime() - startTime}ms`
      );
    }

    const totalSkipped = Object.values(skipReasons).reduce(
      (acc, val) => acc + val,
      0
    );
    const reportLines = [
      '╔═══════════════════════╤════════════╗',
      '║ Skip Reason           │ Count      ║',
      '╟───────────────────────┼────────────╢',
      ...Object.entries(skipReasons)
        .filter(([reason, count]) => count > 0)
        .map(
          ([reason, count]) =>
            `║ ${reason.padEnd(21)} │ ${String(count).padStart(10)} ║`
        ),
      '╟───────────────────────┼────────────╢',
      `║ Total Skipped         │ ${String(totalSkipped).padStart(10)} ║`,
      '╚═══════════════════════╧════════════╝',
    ];

    if (totalSkipped > 0) logger.info('\n' + reportLines.join('\n'));

    // Create stream objects
    const streamsStartTime = new Date().getTime();
    const streamObjects = await Promise.all(
      filteredResults.map(this.createStreamObject.bind(this))
    );
    streams.push(...streamObjects.filter((s) => s !== null));

    // Add error streams to the end
    streams.push(
      ...errorStreams.map((e) => errorStream(e.error, e.addon.name))
    );

    logger.info(
      `Created ${streams.length} stream objects in ${getTimeTakenSincePoint(streamsStartTime)}`
    );
    logger.info(
      `Total time taken to get streams: ${getTimeTakenSincePoint(startTime)}`
    );
    return streams;
  }

  private async createMediaFlowStream(
    parsedStream: ParsedStream,
    name: string,
    description: string
  ): Promise<Stream> {
    if (!parsedStream.url) {
      logger.error(
        `Stream URL is missing, cannot proxy a stream without a URL`,
        { func: 'createMediaFlowStream' }
      );
      throw new Error('Stream URL is missing');
    }

    const mediaFlowConfig = getMediaFlowConfig(this.config);
    const proxiedUrl = await createProxiedMediaFlowUrl(
      parsedStream.url,
      mediaFlowConfig,
      parsedStream.stream?.behaviorHints?.proxyHeaders
    );
    if (!proxiedUrl) {
      throw new Error('Could not create MediaFlow proxied URL');
    }
    const combinedTags = [
      parsedStream.resolution,
      parsedStream.quality,
      parsedStream.encode,
      ...parsedStream.visualTags,
      ...parsedStream.audioTags,
      ...parsedStream.languages,
    ];

    return {
      url: proxiedUrl,
      name: this.config.addonNameInDescription
        ? Settings.ADDON_NAME
        : `🕵️ ${name}`,
      description: this.config.addonNameInDescription
        ? `🕵️ ${name.split('\n').join(' ')}\n${description}`
        : description,
      subtitles: parsedStream.stream?.subtitles,
      behaviorHints: {
        notWebReady: parsedStream.stream?.behaviorHints?.notWebReady,
        filename: parsedStream.filename,
        videoSize: Math.floor(parsedStream.size || 0) || undefined,
        videoHash: parsedStream.stream?.behaviorHints?.videoHash,
        bingeGroup: `mfp.${Settings.ADDON_ID}|${parsedStream.addon.name}|${combinedTags.join('|')}`,
      },
    };
  }

  private shouldProxyStream(stream: ParsedStream): boolean {
    const mediaFlowConfig = getMediaFlowConfig(this.config);
    if (!mediaFlowConfig.mediaFlowEnabled) return false;
    if (!stream.url) return false;
    // // now check if mediaFlowConfig.proxiedAddons or mediaFlowConfig.proxiedServices is not null
    // logger.info(this.config.mediaFlowConfig?.proxiedAddons);
    // logger.info(stream.addon.id);
    if (
      mediaFlowConfig.proxiedAddons &&
      mediaFlowConfig.proxiedAddons.length > 0 &&
      !mediaFlowConfig.proxiedAddons.includes(stream.addon.id)
    ) {
      return false;
    }

    if (
      (mediaFlowConfig.proxiedServices &&
        mediaFlowConfig.proxiedServices.length > 0 &&
        stream.provider &&
        !mediaFlowConfig.proxiedServices.includes(stream.provider.id)) ||
      (mediaFlowConfig.proxiedServices &&
        mediaFlowConfig.proxiedServices.length > 0 &&
        !stream.provider &&
        !mediaFlowConfig.proxiedServices.includes('none'))
    ) {
      return false;
    }

    return true;
  }

  private async createStreamObject(
    parsedStream: ParsedStream
  ): Promise<Stream | null> {
    let name: string = '';
    let description: string = '';
    switch (this.config.formatter) {
      case 'gdrive': {
        const { name: _name, description: _description } =
          gdriveFormat(parsedStream);
        name = _name;
        description = _description;
        break;
      }
      case 'minimalistic-gdrive': {
        const { name: _name, description: _description } = gdriveFormat(
          parsedStream,
          true
        );
        name = _name;
        description = _description;
        break;
      }
      case 'imposter': {
        const { name: _name, description: _description } =
          imposterFormat(parsedStream);
        name = _name;
        description = _description;
        break;
      }
      case 'torrentio': {
        const { name: _name, description: _description } =
          torrentioFormat(parsedStream);
        name = _name;
        description = _description;
        break;
      }
      case 'torbox': {
        const { name: _name, description: _description } =
          torboxFormat(parsedStream);
        name = _name;
        description = _description;
        break;
      }
      default: {
        throw new Error('Unsupported formatter');
      }
    }

    const combinedTags = [
      parsedStream.resolution,
      parsedStream.quality,
      parsedStream.encode,
      ...parsedStream.visualTags,
      ...parsedStream.audioTags,
      ...parsedStream.languages,
    ];

    let stream: Stream;
    const shouldProxy = this.shouldProxyStream(parsedStream);
    if (shouldProxy) {
      try {
        const mediaFlowStream = await this.createMediaFlowStream(
          parsedStream,
          name,
          description
        );
        if (!mediaFlowStream) {
          throw new Error('Unknown error creating MediaFlow stream');
        }
        return mediaFlowStream;
      } catch (error) {
        logger.error(`Failed to create MediaFlow stream URL: ${error}`);
        return null;
      }
    }

    stream = {
      url: parsedStream.url,
      externalUrl: parsedStream.externalUrl,
      infoHash: parsedStream.torrent?.infoHash,
      fileIdx: parsedStream.torrent?.fileIdx,
      name: this.config.addonNameInDescription
        ? Settings.ADDON_NAME
        : Settings.SHOW_DIE
          ? `🎲 ${name}`
          : name,
      description: this.config.addonNameInDescription
        ? `🎲 ${name.split('\n').join(' ')}\n${description}`
        : description,
      subtitles: parsedStream.stream?.subtitles,
      sources: parsedStream.torrent?.sources,
      behaviorHints: {
        videoSize: Math.floor(parsedStream.size || 0) || undefined,
        filename: parsedStream.filename,
        bingeGroup: `${Settings.ADDON_ID}|${parsedStream.addon.name}|${combinedTags.join('|')}`,
        proxyHeaders: parsedStream.stream?.behaviorHints?.proxyHeaders,
        notWebReady: parsedStream.stream?.behaviorHints?.notWebReady,
      },
    };

    return stream;
  }

  private compareLanguages(a: ParsedStream, b: ParsedStream) {
    if (this.config.prioritiseLanguage) {
      const aHasPrioritisedLanguage = a.languages.includes(
        this.config.prioritiseLanguage
      );
      const bHasPrioritisedLanguage = b.languages.includes(
        this.config.prioritiseLanguage
      );

      if (aHasPrioritisedLanguage && !bHasPrioritisedLanguage) return -1;
      if (!aHasPrioritisedLanguage && bHasPrioritisedLanguage) return 1;
    }
    return 0;
  }

  private compareByField(a: ParsedStream, b: ParsedStream, field: string) {
    if (field === 'resolution') {
      return (
        this.config.resolutions.findIndex(
          (resolution) => resolution[a.resolution]
        ) -
        this.config.resolutions.findIndex(
          (resolution) => resolution[b.resolution]
        )
      );
    } else if (field === 'cached') {
      let aCanbeCached = a.provider;
      let bCanbeCached = b.provider;
      let aCached = a.provider?.cached;
      let bCached = b.provider?.cached;

      // prioritise non debrid/usenet p2p over uncached
      if (aCanbeCached && !bCanbeCached && !aCached) return 1;
      if (!aCanbeCached && bCanbeCached && !bCached) return -1;
      if (aCanbeCached && bCanbeCached) {
        if (aCached === bCached) return 0;
        // prioritise a false value over undefined
        if (aCached === false && bCached === undefined) return -1;
        if (aCached === undefined && bCached === false) return 1;
        return this.config.sortBy.find(
          (sort) => Object.keys(sort)[0] === 'cached'
        )?.direction === 'asc'
          ? aCached
            ? 1
            : -1 // uncached > cached
          : aCached
            ? -1
            : 1; // cached > uncached
      }
    } else if (field === 'hasProvider') {
      // files from a provider should be prioritised and then
      let aHasProvider = a.provider;
      let bHasProvider = b.provider;
      if (aHasProvider && !bHasProvider) return -1;
      if (!aHasProvider && bHasProvider) return 1;
    } else if (field === 'service') {
      // sort files with providers by name
      let aProvider = a.provider?.id;
      let bProvider = b.provider?.id;

      if (aProvider && bProvider) {
        const aIndex = this.config.services.findIndex(
          (service) => service.id === aProvider
        );
        const bIndex = this.config.services.findIndex(
          (service) => service.id === bProvider
        );
        return aIndex - bIndex;
      }
    } else if (field === 'size') {
      return this.config.sortBy.find((sort) => Object.keys(sort)[0] === 'size')
        ?.direction === 'asc'
        ? (a.size || 0) - (b.size || 0)
        : (b.size || 0) - (a.size || 0);
    } else if (field === 'seeders') {
      if (
        a.torrent?.seeders !== undefined &&
        b.torrent?.seeders !== undefined
      ) {
        return this.config.sortBy.find(
          (sort) => Object.keys(sort)[0] === 'seeders'
        )?.direction === 'asc'
          ? a.torrent.seeders - b.torrent.seeders
          : b.torrent.seeders - a.torrent.seeders;
      } else if (
        a.torrent?.seeders !== undefined &&
        b.torrent?.seeders === undefined
      ) {
        return -1;
      } else if (
        a.torrent?.seeders === undefined &&
        b.torrent?.seeders !== undefined
      ) {
        return 1;
      }
    } else if (field === 'streamType') {
      return (
        (this.config.streamTypes?.findIndex(
          (streamType) => streamType[a.type]
        ) ?? -1) -
        (this.config.streamTypes?.findIndex(
          (streamType) => streamType[b.type]
        ) ?? -1)
      );
    } else if (field === 'quality') {
      return (
        this.config.qualities.findIndex((quality) => quality[a.quality]) -
        this.config.qualities.findIndex((quality) => quality[b.quality])
      );
    } else if (field === 'visualTag') {
      // Find the highest priority visual tag in each file
      const getIndexOfTag = (tag: string) =>
        this.config.visualTags.findIndex((t) => t[tag]);

      const getHighestPriorityTagIndex = (tags: string[]) => {
        // Check if the file contains both any HDR tag and DV
        const hasHDR = tags.some((tag) => tag.startsWith('HDR'));
        const hasDV = tags.includes('DV');

        if (hasHDR && hasDV) {
          // Sort according to the position of the HDR+DV tag
          const hdrDvIndex = this.config.visualTags.findIndex(
            (t) => t['HDR+DV']
          );
          if (hdrDvIndex !== -1) {
            return hdrDvIndex;
          }
        }

        // If the file contains multiple HDR tags, look at the HDR tag that has the highest priority
        const hdrTagIndices = tags
          .filter((tag) => tag.startsWith('HDR'))
          .map((tag) => getIndexOfTag(tag));
        if (hdrTagIndices.length > 0) {
          return Math.min(...hdrTagIndices);
        }

        // Always consider the highest priority visual tag when a file has multiple visual tags
        return tags.reduce(
          (minIndex, tag) => Math.min(minIndex, getIndexOfTag(tag)),
          this.config.visualTags.length
        );
      };

      const aVisualTagIndex = getHighestPriorityTagIndex(a.visualTags);
      const bVisualTagIndex = getHighestPriorityTagIndex(b.visualTags);

      // Sort by the visual tag index
      return aVisualTagIndex - bVisualTagIndex;
    } else if (field === 'audioTag') {
      // Find the highest priority audio tag in each file
      const getIndexOfTag = (tag: string) =>
        this.config.audioTags.findIndex((t) => t[tag]);
      const aAudioTagIndex = a.audioTags.reduce(
        (minIndex, tag) => Math.min(minIndex, getIndexOfTag(tag)),
        this.config.audioTags.length
      );

      const bAudioTagIndex = b.audioTags.reduce(
        (minIndex, tag) => Math.min(minIndex, getIndexOfTag(tag)),
        this.config.audioTags.length
      );
      // Sort by the audio tag index
      return aAudioTagIndex - bAudioTagIndex;
    } else if (field === 'encode') {
      return (
        this.config.encodes.findIndex((encode) => encode[a.encode]) -
        this.config.encodes.findIndex((encode) => encode[b.encode])
      );
    } else if (field === 'addon') {
      const aAddon = a.addon.id;
      const bAddon = b.addon.id;

      const addonIds = this.config.addons.map((addon) => {
        return `${addon.id}-${JSON.stringify(addon.options)}`;
      });
      return addonIds.indexOf(aAddon) - addonIds.indexOf(bAddon);
    } else if (field === 'language') {
      if (this.config.prioritiseLanguage) {
        return this.compareLanguages(a, b);
      }
      if (!this.config.prioritisedLanguages) {
        return 0;
      }
      // else, we look at the array of prioritisedLanguages.
      // any file with a language in the prioritisedLanguages array should be prioritised
      // if both files contain a prioritisedLanguage, we compare the index of the highest priority language

      const aHasPrioritisedLanguage =
        a.languages.some((lang) =>
          this.config.prioritisedLanguages?.includes(lang)
        ) ||
        (a.languages.length === 0 &&
          this.config.prioritisedLanguages?.includes('Unknown'));
      const bHasPrioritisedLanguage =
        b.languages.some((lang) =>
          this.config.prioritisedLanguages?.includes(lang)
        ) ||
        (b.languages.length === 0 &&
          this.config.prioritisedLanguages?.includes('Unknown'));

      if (aHasPrioritisedLanguage && !bHasPrioritisedLanguage) return -1;
      if (!aHasPrioritisedLanguage && bHasPrioritisedLanguage) return 1;

      if (aHasPrioritisedLanguage && bHasPrioritisedLanguage) {
        const getHighestPriorityLanguageIndex = (languages: string[]) => {
          if (languages.length === 0) {
            const unknownIndex =
              this.config.prioritisedLanguages!.indexOf('Unknown');
            return unknownIndex !== -1
              ? unknownIndex
              : this.config.prioritisedLanguages!.length;
          }
          return languages.reduce((minIndex, lang) => {
            const index =
              this.config.prioritisedLanguages?.indexOf(lang) ??
              this.config.prioritisedLanguages!.length;
            return index !== -1 ? Math.min(minIndex, index) : minIndex;
          }, this.config.prioritisedLanguages!.length);
        };

        const aHighestPriorityLanguageIndex = getHighestPriorityLanguageIndex(
          a.languages
        );
        const bHighestPriorityLanguageIndex = getHighestPriorityLanguageIndex(
          b.languages
        );

        return aHighestPriorityLanguageIndex - bHighestPriorityLanguageIndex;
      }
    }
    return 0;
  }

  private async getParsedStreams(
    streamRequest: StreamRequest
  ): Promise<{ parsedStreams: ParsedStream[]; errorStreams: ErrorStream[] }> {
    const parsedStreams: ParsedStream[] = [];
    const errorStreams: ErrorStream[] = [];
    const formatError = (error: string) =>
      typeof error === 'string'
        ? error
            .replace(/- |: /g, '\n')
            .split('\n')
            .map((line: string) => line.trim())
            .join('\n')
            .trim()
        : error;

    const addonPromises = this.config.addons.map(async (addon) => {
      const addonName =
        addon.options.name ||
        addon.options.overrideName ||
        addonDetails.find((addonDetail) => addonDetail.id === addon.id)?.name ||
        addon.id;
      const addonId = `${addon.id}-${JSON.stringify(addon.options)}`;
      try {
        const startTime = new Date().getTime();
        const { addonStreams, addonErrors } = await this.getStreamsFromAddon(
          addon,
          addonId,
          streamRequest
        );
        parsedStreams.push(...addonStreams);
        errorStreams.push(
          ...[...new Set(addonErrors)].map((error) => ({
            error: formatError(error),
            addon: { id: addonId, name: addonName },
          }))
        );
        logger.info(
          `Got ${addonStreams.length} streams ${addonErrors.length > 0 ? `and ${addonErrors.length} errors ` : ''}from addon ${addonName} in ${getTimeTakenSincePoint(startTime)}`
        );
      } catch (error: any) {
        logger.error(`Failed to get streams from ${addonName}: ${error}`);
        errorStreams.push({
          error: formatError(error.message ?? error ?? 'Unknown error'),
          addon: {
            id: addonId,
            name: addonName,
          },
        });
      }
    });

    await Promise.all(addonPromises);
    return { parsedStreams, errorStreams };
  }

  private async getStreamsFromAddon(
    addon: Config['addons'][0],
    addonId: string,
    streamRequest: StreamRequest
  ): Promise<{ addonStreams: ParsedStream[]; addonErrors: string[] }> {
    switch (addon.id) {
      case 'torbox': {
        return await getTorboxStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'torrentio': {
        return await getTorrentioStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'comet': {
        return await getCometStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'mediafusion': {
        return await getMediafusionStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'stremio-jackett': {
        return await getStremioJackettStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'jackettio': {
        return await getJackettioStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'orion-stremio-addon': {
        return await getOrionStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'easynews': {
        return await getEasynewsStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'easynews-plus': {
        return await getEasynewsPlusStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'debridio': {
        return await getDebridioStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'peerflix': {
        return await getPeerflixStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'dmm-cast': {
        return await getDMMCastStreams(
          this.config,
          addon.options,
          streamRequest,
          addonId
        );
      }
      case 'gdrive': {
        if (!addon.options.addonUrl) {
          throw new Error('The addon URL was undefined for GDrive');
        }
        const wrapper = new BaseWrapper(
          addon.options.overrideName || 'GDrive',
          addon.options.addonUrl,
          addonId,
          this.config,
          addon.options.indexerTimeout
            ? parseInt(addon.options.indexerTimeout)
            : Settings.DEFAULT_GDRIVE_TIMEOUT
        );
        return await wrapper.getParsedStreams(streamRequest);
      }
      default: {
        if (!addon.options.url) {
          throw new Error(
            `The addon URL was undefined for ${addon.options.name}`
          );
        }
        const wrapper = new BaseWrapper(
          addon.options.name || 'Custom',
          addon.options.url.trim(),
          addonId,
          this.config,
          addon.options.indexerTimeout
            ? parseInt(addon.options.indexerTimeout)
            : undefined
        );
        return wrapper.getParsedStreams(streamRequest);
      }
    }
  }
  private async processGroupedStreams(
    groupedStreams: Record<string, ParsedStream[]>
  ) {
    const uniqueStreams: ParsedStream[] = [];
    Object.values(groupedStreams).forEach((groupedStreams) => {
      if (groupedStreams.length === 1) {
        uniqueStreams.push(groupedStreams[0]);
        return;
      }

      /*logger.info(
        `==================\nDetermining unique streams for ${groupedStreams[0].filename} from ${groupedStreams.length} total duplicates`
      );
      logger.info(
        groupedStreams.map(
          (stream) =>
            `Addon ID: ${stream.addon.id}, Provider ID: ${stream.provider?.id}, Provider Cached: ${stream.provider?.cached}, type: ${stream.torrent ? 'torrent' : 'usenet'}`
        )
      );
      logger.info('==================');*/
      // Separate streams into categories
      const cachedStreams = groupedStreams.filter(
        (stream) => stream.provider?.cached || (!stream.provider && stream.url)
      );
      const uncachedStreams = groupedStreams.filter(
        (stream) => stream.provider && !stream.provider.cached
      );
      const noProviderStreams = groupedStreams.filter(
        (stream) => !stream.provider && stream.torrent?.infoHash
      );

      // Select uncached streams by addon priority (one per provider)
      const selectedUncachedStreams = Object.values(
        uncachedStreams.reduce(
          (acc, stream) => {
            acc[stream.provider!.id] = acc[stream.provider!.id] || [];
            acc[stream.provider!.id].push(stream);
            return acc;
          },
          {} as Record<string, ParsedStream[]>
        )
      ).map((providerGroup) => {
        return providerGroup.sort((a, b) => {
          const aIndex = this.config.addons.findIndex(
            (addon) =>
              `${addon.id}-${JSON.stringify(addon.options)}` === a.addon.id
          );
          const bIndex = this.config.addons.findIndex(
            (addon) =>
              `${addon.id}-${JSON.stringify(addon.options)}` === b.addon.id
          );
          return aIndex - bIndex;
        })[0];
      });
      //selectedUncachedStreams.forEach(stream => logger.info(`Selected uncached stream for provider ${stream.provider!.id}: Addon ID: ${stream.addon.id}`));

      // Select cached streams by provider and addon priority
      const selectedCachedStream = cachedStreams.sort((a, b) => {
        const aProviderIndex = this.config.services.findIndex(
          (service) => service.id === a.provider?.id
        );
        const bProviderIndex = this.config.services.findIndex(
          (service) => service.id === b.provider?.id
        );

        if (aProviderIndex !== bProviderIndex) {
          return aProviderIndex - bProviderIndex;
        }

        const aAddonIndex = this.config.addons.findIndex(
          (addon) =>
            `${addon.id}-${JSON.stringify(addon.options)}` === a.addon.id
        );
        const bAddonIndex = this.config.addons.findIndex(
          (addon) =>
            `${addon.id}-${JSON.stringify(addon.options)}` === b.addon.id
        );

        if (aAddonIndex !== bAddonIndex) {
          return aAddonIndex - bAddonIndex;
        }

        // now look at the type of stream. prefer usenet over torrents
        if (a.torrent?.seeders && !b.torrent?.seeders) return 1;
        if (!a.torrent?.seeders && b.torrent?.seeders) return -1;
        return 0;
      })[0];
      // Select one non-provider stream (highest addon priority)
      const selectedNoProviderStream = noProviderStreams.sort((a, b) => {
        const aIndex = this.config.addons.findIndex(
          (addon) =>
            `${addon.id}-${JSON.stringify(addon.options)}` === a.addon.id
        );
        const bIndex = this.config.addons.findIndex(
          (addon) =>
            `${addon.id}-${JSON.stringify(addon.options)}` === b.addon.id
        );

        if (aIndex !== bIndex) {
          return aIndex - bIndex;
        }

        // now look at the type of stream. prefer usenet over torrents
        if (a.torrent?.seeders && !b.torrent?.seeders) return 1;
        if (!a.torrent?.seeders && b.torrent?.seeders) return -1;
        return 0;
      })[0];

      // Combine selected streams for this group
      if (selectedNoProviderStream) {
        //logger.info(`Selected no provider stream: Addon ID: ${selectedNoProviderStream.addon.id}`);
        uniqueStreams.push(selectedNoProviderStream);
      }
      if (selectedCachedStream) {
        //logger.info(`Selected cached stream for provider ${selectedCachedStream.provider!.id} from Addon ID: ${selectedCachedStream.addon.id}`);
        uniqueStreams.push(selectedCachedStream);
      }
      uniqueStreams.push(...selectedUncachedStreams);
    });

    return uniqueStreams;
  }
}
