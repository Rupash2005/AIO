// the data that is parsed from a filename
export interface ParsedNameData {
  resolution: string;
  quality: string;
  encode: string;
  visualTags: string[];
  audioTags: string[];
  languages: string[];
}

// the parsed stream data which is to be used to create the final stream object
export interface ParsedStream extends ParsedNameData {
  addon: {
    id: string;
    name: string;
  };
  filename?: string;
  message?: string;
  size?: number;
  provider?: {
    id: string;
    cached?: boolean;
  };
  _infoHash?: string; // this infohash is used to determine duplicates, provided so that debrid strems aren't mistaken for torrent streams by providing torrent.infoHash
  torrent?: {
    infoHash?: string;
    fileIdx?: number;
    seeders?: number;
    sources?: string[];
  };
  usenet?: {
    age?: string;
  };
  type: 'usenet' | 'debrid' | 'p2p' | 'live' | 'unknown';
  duration?: number;
  url?: string;
  externalUrl?: string;
  indexers?: string;
  personal?: boolean;
  stream?: {
    subtitles?: Subtitle[];
    behaviorHints?: {
      countryWhitelist?: string[];
      notWebReady?: boolean;
      proxyHeaders?: {
        request?: { [key: string]: string };
        response?: { [key: string]: string };
      };
      videoHash?: string;
    };
  };
}

export interface ErrorStream {
  error: string;
  addon: {
    id: string;
    name: string;
  };
}

interface ErrorParseResult {
  type: 'error';
  result: string;
}

interface SuccessParseResult {
  type: 'stream';
  result: ParsedStream;
}

export type ParseResult = SuccessParseResult | ErrorParseResult;

export interface CollectedParsedStreams {
  [key: string]: ParsedStream[];
}

export interface Stream {
  url?: string;
  externalUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  name?: string;
  title?: string;
  description?: string;
  subtitles?: Subtitle[];
  sources?: string[];
  behaviorHints?: {
    countryWhitelist?: string[];
    notWebReady?: boolean;
    bingeGroup?: string;
    proxyHeaders?: {
      request?: { [key: string]: string };
      response?: { [key: string]: string };
    };
    videoHash?: string;
    videoSize?: number;
    filename?: string;
  };
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

export interface StreamRequest {
  id: string;
  type: 'series' | 'movie';
}

export type Resolution = { [key: string]: boolean };
export type Quality = { [key: string]: boolean };
export type VisualTag = { [key: string]: boolean };
export type AudioTag = { [key: string]: boolean };
export type Encode = { [key: string]: boolean };
export type SortBy = { [key: string]: boolean | string | undefined };
export type StreamType = { [key: string]: boolean };

export interface Config {
  overrideName?: string;
  instanceCache?: any;
  requestingIp?: string;
  resolutions: Resolution[];
  qualities: Quality[];
  visualTags: VisualTag[];
  audioTags: AudioTag[];
  encodes: Encode[];
  sortBy: SortBy[];
  streamTypes: StreamType[];
  onlyShowCachedStreams: boolean;
  prioritiseLanguage?: string; // from older configurations
  prioritisedLanguages: string[] | null;
  excludedLanguages: string[] | null;
  formatter: string;
  customFormatter?: {
    splitter: string; // e.g. ' - ', ' | ' etc. the string used to split the tags
    // we need to have a key for where the value has to be determined from the stream data.
    // examples of this is provider and seedersOrAge. provider.cached has different states and seedersOrAge has different states

    // available values:
    // {resolution}, {quality}, {streamType} {encode}, {visualTags}, {audioTags}, {languages}, {provider}, {seedersOrAge}, {filename}, {size}, {addonName}, {seedersOrAge}
    languages: {
      useEmojis: boolean; // e.g. 🇬🇧
    };
    hideIfUnknown: boolean; // if true, the tag will not be shown if the value is unknown
    provider: {
      trueCacheStatus: string; // e.g. ⚡️
      falseCacheStatus: string; // e.g. ⏳
      undefinedCacheStatus: string; // e.g. ❓
      finalString: string; // e.g. [{providerShortName}{cacheStatus}]  ->  [TB⚡️] or this could be left empty
    };
    streamType: {
      torrent: string; // e.g. 🧲
      usenet: string; // e.g. 📡
      direct: string; // e.g. 📥
      unknown: string; // e.g. ❓
      finalString: string; // e.g. {streamType}  ->  🧲
    };
    seedersOrAge: {
      whenSeeders: string; // e.g. 👤
      whenAge: string; // e.g. 📅
      finalString: string; // e.g. {seedersOrAge} {seedersOrAgeValue}
    };
    name: string;
    description: string;
  };
  maxSize?: number | null;
  minSize?: number | null;
  maxMovieSize: number | null;
  minMovieSize: number | null;
  maxEpisodeSize: number | null;
  minEpisodeSize: number | null;
  addonNameInDescription?: boolean;
  cleanResults: boolean;
  maxResultsPerResolution: number | null;
  excludeFilters: string[] | null;
  strictIncludeFilters: string[] | null;
  mediaFlowConfig?: {
    mediaFlowEnabled: boolean;
    proxyUrl: string;
    apiPassword: string;
    publicIp: string;
    proxiedAddons: string[] | null;
    proxiedServices: string[] | null;
  };
  addons: {
    id: string;
    options: { [key: string]: string | undefined };
  }[];
  services: {
    name: string;
    id: string;
    enabled: boolean;
    credentials: { [key: string]: string };
  }[];
}

interface BaseOptionDetail {
  id: string;
  secret?: boolean;
  required?: boolean;
  label: string;
  description?: string;
}

export interface DeprecatedOptionDetail extends BaseOptionDetail {
  type: 'deprecated';
}

export interface TextOptionDetail extends BaseOptionDetail {
  type: 'text';
}

export interface SelectOptionDetail extends BaseOptionDetail {
  type: 'select';
  options: { value: string; label: string }[];
}

export interface MultiSelectOptionDetail extends BaseOptionDetail {
  type: 'multiSelect';
  options: { value: string; label: string }[];
}

export interface CheckboxOptionDetail extends BaseOptionDetail {
  type: 'checkbox';
}

export interface NumberOptionDetail extends BaseOptionDetail {
  type: 'number';
  constraints: {
    min?: number;
    max?: number;
  };
}

export type AddonOptionDetail =
  | TextOptionDetail
  | SelectOptionDetail
  | MultiSelectOptionDetail
  | CheckboxOptionDetail
  | NumberOptionDetail
  | DeprecatedOptionDetail;

export interface AddonDetail {
  name: string;
  id: string;
  requiresService: boolean;
  supportedServices: string[];
  options?: AddonOptionDetail[];
}

export interface ServiceDetail {
  name: string;
  id: string;
  shortName: string;
  knownNames: string[];
  credentials: ServiceCredential[];
}

export interface ServiceCredential {
  id: string;
  label: string;
  link?: string;
}
