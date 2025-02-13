import express, { Request, Response } from 'express';

import path from 'path';
import { AIOStreams } from './addon';
import { Config, StreamRequest } from '@aiostreams/types';
import { validateConfig } from './config';
import manifest from './manifest';
import { errorResponse } from './responses';
import {
  Settings,
  addonDetails,
  parseAndDecryptString,
  Cache,
  unminifyConfig,
  minifyConfig,
  crushJson,
  compressData,
  encryptData,
  decompressData,
  decryptData,
  uncrushJson,
} from '@aiostreams/utils';

const app = express();
console.log(`|INF| server > init: Starting server and loading settings...`);
Object.entries(Settings).forEach(([key, value]) => {
  switch (key) {
    case 'SECRET_KEY':
      if (value) {
        console.log(
          `|INF| server > init: ${key} = ${value.replace(/./g, '*').slice(0, 32)}`
        );
      }
      break;

    case 'BRANDING':
    case 'CUSTOM_CONFIGS':
      // Skip CUSTOM_CONFIGS processing here, handled later
      break;

    default:
      console.log(`|INF| server > init: ${key} = ${value}`);
  }
});

if (!Settings.SECRET_KEY) {
  console.warn(
    '|WRN| server > init: SECRET_KEY is not set, data encryption is disabled!'
  );
}

let CUSTOM_CONFIGS: Record<string, string> = {};
if (Settings.CUSTOM_CONFIGS) {
  try {
    CUSTOM_CONFIGS = JSON.parse(Settings.CUSTOM_CONFIGS);
    console.log(
      `|INF| server > init: Loaded ${Object.keys(CUSTOM_CONFIGS).length} custom configs under aliases ${Object.keys(CUSTOM_CONFIGS).join(', ')}`
    );
  } catch (error: any) {
    console.error(
      `|ERR| server > init: CUSTOM_CONFIGS is not valid JSON: ${error.message}`
    );
  }
}

const cache = new Cache(Settings.MAX_CACHE_SIZE);

// Built-in middleware for parsing JSON
app.use(express.json());
// Built-in middleware for parsing URL-encoded data
app.use(express.urlencoded({ extended: true }));

// unhandled errors
app.use((err: any, req: Request, res: Response, next: any) => {
  console.error(`|ERR| server > ${err.message}`);
  res.status(500).send('Internal server error');
});

app.use((req, res, next) => {
  res.append('Access-Control-Allow-Origin', '*');
  res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
  console.log(
    `|DBG| server > ${req.method} ${req.path.replace(/\/eyJ[\w\=]+/g, '/*******').replace(/\/E2?-[\w-\%]+/g, '/*******')}`
  );
  next();
});

app.get('/', (req, res) => {
  res.redirect('/configure');
});

app.get(
  ['/_next/*', '/assets/*', '/icon.ico', '/configure.txt'],
  (req, res) => {
    res.sendFile(path.join(__dirname, '../../frontend/out', req.path));
  }
);

if (!Settings.DISABLE_CUSTOM_CONFIG_GENERATOR_ROUTE) {
  app.get('/custom-config-generator', (req, res) => {
    res.sendFile(
      path.join(__dirname, '../../frontend/out/custom-config-generator.html')
    );
  });
}

app.get('/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/out/configure.html'));
});

app.get('/:config/configure', (req, res) => {
  const config = req.params.config;
  if (config.startsWith('eyJ') || config.startsWith('eyI')) {
    return res.sendFile(
      path.join(__dirname, '../../frontend/out/configure.html')
    );
  }
  try {
    let configJson = extractJsonConfig(config);
    if (config.startsWith('E-') || config.startsWith('E2-')) {
      console.log(
        `|DBG| server > Encrypted config detected, encrypting credentials`
      );
      configJson = encryptInfoInConfig(configJson);
    }
    const base64Config = Buffer.from(JSON.stringify(configJson)).toString(
      'base64'
    );
    res.redirect(`/${encodeURIComponent(base64Config)}/configure`);
  } catch (error: any) {
    console.error(`|ERR| server > Failed to extract config: ${error.message}`);
    res.status(400).send('Invalid config');
  }
});

app.get('/manifest.json', (req, res) => {
  res.status(200).json(manifest());
});

app.get('/:config/manifest.json', (req, res) => {
  const config = decodeURIComponent(req.params.config);
  let configJson: Config;
  try {
    configJson = extractJsonConfig(config);
    console.log(`|DBG| server > Extracted config for manifest request`);
    configJson = decryptEncryptedInfoFromConfig(configJson);
    if (Settings.LOG_SENSITIVE_INFO) {
      console.log(`|DBG| server > Final config: ${JSON.stringify(configJson)}`);
    }
    console.log(
      `|DBG| server > Successfully removed or decrypted sensitive info`
    );
    const { valid, errorMessage } = validateConfig(configJson);
    if (!valid) {
      console.error(
        `|ERR| server > Received invalid config for manifest request: ${errorMessage}`
      );
      res.status(400).json({ error: 'Invalid config', message: errorMessage });
      return;
    }
  } catch (error: any) {
    console.error(`|ERR| server > Failed to extract config: ${error.message}`);
    res.status(400).json({ error: 'Invalid config' });
    return;
  }
  res.status(200).json(manifest(configJson));
});

// Route for /stream
app.get('/stream/:type/:id', (req: Request, res: Response) => {
  res
    .status(200)
    .json(
      errorResponse(
        'You must configure this addon to use it',
        rootUrl(req),
        '/configure'
      )
    );
});

app.get('/:config/stream/:type/:id.json', (req, res: Response): void => {
  const { config, type, id } = req.params;
  let configJson: Config;
  try {
    configJson = extractJsonConfig(config);
    console.log(`|DBG| server > Extracted config for stream request`);
    configJson = decryptEncryptedInfoFromConfig(configJson);
    if (Settings.LOG_SENSITIVE_INFO) {
      console.log(`|DBG| server > Final config: ${JSON.stringify(configJson)}`);
    }
    console.log(
      `|DBG| server > Successfully removed or decrypted sensitive info`
    );
  } catch (error: any) {
    console.error(`|ERR| server > Failed to extract config: ${error.message}`);
    res.json(
      errorResponse(
        `${error.message}, please check the logs or click this stream to create an issue on GitHub`,
        rootUrl(req),
        undefined,
        'https://github.com/Viren070/AIOStreams/issues/new?template=bug_report.yml'
      )
    );
    return;
  }

  console.log(`|DBG| server > Requesting streams for ${type} ${id}`);

  if (type !== 'movie' && type !== 'series') {
    console.error(`|ERR| server > Invalid type for stream request`);
    res.json(
      errorResponse(
        'Invalid type for stream request, must be movie or series',
        rootUrl(req),
        '/'
      )
    );
    return;
  }
  let streamRequest: StreamRequest = { id, type };

  try {
    const { valid, errorCode, errorMessage } = validateConfig(configJson);
    if (!valid) {
      console.error(
        `|ERR| server > Received invalid config: ${errorCode} - ${errorMessage}`
      );
      res.json(
        errorResponse(errorMessage ?? 'Unknown', rootUrl(req), '/configure')
      );
      return;
    }
    configJson.requestingIp =
      req.get('X-Forwarded-For') ||
      req.get('X-Real-IP') ||
      req.get('CF-Connecting-IP') ||
      req.ip;
    configJson.instanceCache = cache;
    const aioStreams = new AIOStreams(configJson);
    aioStreams
      .getStreams(streamRequest)
      .then((streams) => {
        res.json({ streams: streams });
      })
      .catch((error: any) => {
        console.error(`|ERR| server > Internal addon error: ${error.message}`);
        res.json(
          errorResponse(
            'An unexpected error occurred, please check the logs or create an issue on GitHub',
            rootUrl(req),
            undefined,
            'https://github.com/Viren070/AIOStreams/issues/new?template=bug_report.yml'
          )
        );
      });
  } catch (error: any) {
    console.error(`|ERR| server > Internal addon error: ${error.message}`);
    res.json(
      errorResponse(
        'An unexpected error occurred, please check the logs or create an issue on GitHub',
        rootUrl(req),
        undefined,
        'https://github.com/Viren070/AIOStreams/issues/new?template=bug_report.yml'
      )
    );
  }
});

app.post('/encrypt-user-data', (req, res) => {
  const { data } = req.body;
  let finalString: string = '';
  if (!data) {
    console.error('|ERR| server > /encrypt-user-data: No data provided');
    res.json({ success: false, message: 'No data provided' });
    return;
  }
  // First, validate the config
  try {
    const config = JSON.parse(data);
    const { valid, errorCode, errorMessage } = validateConfig(config);
    if (!valid) {
      console.error(
        `|ERR| server > generateConfig: Invalid config: ${errorCode} - ${errorMessage}`
      );
      res.json({ success: false, message: errorMessage, error: errorMessage });
      return;
    }
  } catch (error: any) {
    console.error(
      `|ERR| server > /encrypt-user-data: Invalid JSON: ${error.message}`
    );
    res.json({ success: false, message: 'Malformed configuration' });
    return;
  }

  try {
    const minified = minifyConfig(JSON.parse(data));
    const crushed = crushJson(JSON.stringify(minified));
    const compressed = compressData(crushed);
    if (!Settings.SECRET_KEY) {
      // use base64 encoding if no secret key is set
      finalString = `B-${encodeURIComponent(compressed.toString('base64'))}`;
    } else {
      const { iv, data } = encryptData(compressed);
      finalString = `E2-${encodeURIComponent(iv)}-${encodeURIComponent(data)}`;
    }

    console.log(
      `|INF| server > /encrypt-user-data: Encrypted user data, compression report:`
    );
    console.log(`+--------------------------------------------+`);
    console.log(`| Original:         ${data.length} bytes`);
    console.log(`| URL Encoded:      ${encodeURIComponent(data).length} bytes`);
    console.log(`| Minified:         ${JSON.stringify(minified).length} bytes`);
    console.log(`| Crushed:          ${crushed.length} bytes`);
    console.log(`| Compressed:       ${compressed.length} bytes`);
    console.log(`| Final String:     ${finalString.length} bytes`);
    console.log(
      `| Ratio:            ${((finalString.length / data.length) * 100).toFixed(2)}%`
    );
    console.log(
      `| Reduction:        ${data.length - compressed.length} bytes (${(((data.length - compressed.length) / data.length) * 100).toFixed(2)}%)`
    );
    console.log(`+--------------------------------------------+`);

    res.json({ success: true, data: finalString });
  } catch (error: any) {
    console.error(`|ERR| server > /encrypt-user-data: ${error.message}`);
    console.error(error);
    res.json({ success: false, message: error.message });
  }
});

app.get('/get-addon-config', (req, res) => {
  res.status(200).json({
    success: true,
    maxMovieSize: Settings.MAX_MOVIE_SIZE,
    maxEpisodeSize: Settings.MAX_EPISODE_SIZE,
    torrentioDisabled: Settings.DISABLE_TORRENTIO,
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// define 404
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '../../frontend/out/404.html'));
});

app.listen(Settings.PORT, () => {
  console.log(`|INF| server > init: Listening on port ${Settings.PORT}`);
});

function extractJsonConfig(config: string): Config {
  if (
    config.startsWith('E-') ||
    config.startsWith('eyJ') ||
    config.startsWith('eyI') ||
    config.startsWith('E2-') ||
    config.startsWith('B-')
  ) {
    return extractEncryptedOrEncodedConfig(config, 'Config');
  }
  if (CUSTOM_CONFIGS) {
    const customConfig = extractCustomConfig(config);
    if (customConfig) return customConfig;
  }
  throw new Error('Config was in an unexpected format');
}

function extractCustomConfig(config: string): Config | undefined {
  const customConfig = CUSTOM_CONFIGS?.[config];
  if (!customConfig) return undefined;
  console.log(
    `|DBG| server > Found custom config for alias ${config}, attempting to extract config`
  );
  return extractEncryptedOrEncodedConfig(
    decodeURIComponent(customConfig),
    `CustomConfig ${config}`
  );
}

function extractEncryptedOrEncodedConfig(
  config: string,
  label: string
): Config {
  let decodedConfig: Config;
  try {
    if (config.startsWith('E-')) {
      // compressed and encrypted (hex)
      console.log(`|DBG| server > Extracting encrypted (v1) config`);
      const parts = config.split('-');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted config format');
      }
      const iv = Buffer.from(decodeURIComponent(parts[1]), 'hex');
      const data = Buffer.from(decodeURIComponent(parts[2]), 'hex');
      decodedConfig = JSON.parse(decompressData(decryptData(data, iv)));
    } else if (config.startsWith('E2-')) {
      // minified, crushed, compressed and encrypted (base64)
      console.log(`|DBG| server > Extracting encrypted (v2) config`);
      const parts = config.split('-');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted config format');
      }
      const iv = Buffer.from(decodeURIComponent(parts[1]), 'base64');
      const data = Buffer.from(decodeURIComponent(parts[2]), 'base64');
      const compressedCrushedJson = decryptData(data, iv);
      const crushedJson = decompressData(compressedCrushedJson);
      const minifiedConfig = uncrushJson(crushedJson);
      decodedConfig = unminifyConfig(JSON.parse(minifiedConfig));
    } else if (config.startsWith('B-')) {
      // minifed, crushed, compressed, base64 encoded
      console.log(
        `|DBG| server > Extracting base64 encoded and compressed config`
      );
      decodedConfig = unminifyConfig(
        JSON.parse(
          uncrushJson(decompressData(Buffer.from(config.slice(2), 'base64')))
        )
      );
    } else {
      // plain base64 encoded
      console.log(`|DBG| server > Extracting plain base64 encoded config`);
      decodedConfig = JSON.parse(
        Buffer.from(config, 'base64').toString('utf-8')
      );
    }
    return decodedConfig;
  } catch (error: any) {
    console.error(`|ERR| Failed to parse ${label}: ${error.message}`);
    console.error(error);
    throw new Error(`Failed to parse ${label}`);
  }
}

function decryptEncryptedInfoFromConfig(config: Config): Config {
  if (config.services) {
    config.services.forEach(
      (service) =>
        service.credentials &&
        processObjectValues(
          service.credentials,
          `service ${service.id}`,
          true,
          (key, value) => isValueEncrypted(value)
        )
    );
  }

  if (config.mediaFlowConfig) {
    decryptMediaFlowConfig(config.mediaFlowConfig);
  }

  if (config.addons) {
    config.addons.forEach((addon) => {
      if (addon.options) {
        processObjectValues(
          addon.options,
          `addon ${addon.id}`,
          true,
          (key, value) =>
            isValueEncrypted(value) &&
            // Decrypt only if the option is secret
            (
              addonDetails.find((addonDetail) => addonDetail.id === addon.id)
                ?.options ?? []
            ).some((option) => option.id === key && option.secret)
        );
      }
    });
  }
  return config;
}

function decryptMediaFlowConfig(mediaFlowConfig: {
  apiPassword: string;
  proxyUrl: string;
  publicIp: string;
}): void {
  const { apiPassword, proxyUrl, publicIp } = mediaFlowConfig;
  mediaFlowConfig.apiPassword = decryptValue(
    apiPassword,
    'MediaFlow apiPassword'
  );
  mediaFlowConfig.proxyUrl = decryptValue(proxyUrl, 'MediaFlow proxyUrl');
  mediaFlowConfig.publicIp = decryptValue(publicIp, 'MediaFlow publicIp');
}

function encryptInfoInConfig(config: Config): Config {
  if (config.services) {
    config.services.forEach(
      (service) =>
        service.credentials &&
        processObjectValues(
          service.credentials,
          `service ${service.id}`,
          false,
          () => true
        )
    );
  }

  if (config.mediaFlowConfig) {
    encryptMediaFlowConfig(config.mediaFlowConfig);
  }

  if (config.addons) {
    config.addons.forEach((addon) => {
      if (addon.options) {
        processObjectValues(
          addon.options,
          `addon ${addon.id}`,
          false,
          (key) => {
            const addonDetail = addonDetails.find(
              (addonDetail) => addonDetail.id === addon.id
            );
            if (!addonDetail) return false;
            const optionDetail = addonDetail.options?.find(
              (option) => option.id === key
            );
            // Encrypt only if the option is secret
            return optionDetail?.secret ?? false;
          }
        );
      }
    });
  }
  return config;
}

function encryptMediaFlowConfig(mediaFlowConfig: {
  apiPassword: string;
  proxyUrl: string;
  publicIp: string;
}): void {
  const { apiPassword, proxyUrl, publicIp } = mediaFlowConfig;
  mediaFlowConfig.apiPassword = encryptValue(
    apiPassword,
    'MediaFlow apiPassword'
  );
  mediaFlowConfig.proxyUrl = encryptValue(proxyUrl, 'MediaFlow proxyUrl');
  mediaFlowConfig.publicIp = encryptValue(publicIp, 'MediaFlow publicIp');
}

function processObjectValues(
  obj: Record<string, any>,
  labelPrefix: string,
  decrypt: boolean,
  condition: (key: string, value: any) => boolean
): void {
  Object.keys(obj).forEach((key) => {
    const value = obj[key];
    if (condition(key, value)) {
      console.log(`|DBG| Processing ${labelPrefix} ${key}`);
      obj[key] = decrypt
        ? decryptValue(value, `${labelPrefix} ${key}`)
        : encryptValue(value, `${labelPrefix} ${key}`);
    }
  });
}

function encryptValue(value: any, label: string): any {
  if (value && !isValueEncrypted(value)) {
    try {
      const { iv, data } = encryptData(compressData(value));
      return `E2-${iv}-${data}`;
    } catch (error: any) {
      console.error(`Failed to encrypt ${label}`);
      return '';
    }
  }
  return value;
}

function decryptValue(value: any, label: string): any {
  try {
    if (!isValueEncrypted(value)) return value;
    const decrypted = parseAndDecryptString(value);
    if (decrypted === null) throw new Error('Decryption failed');
    return decrypted;
  } catch (error: any) {
    console.error(`|ERR| Failed to decrypt ${label}: ${error.message}`);
    throw new Error('Failed to decrypt config');
  }
}

function isValueEncrypted(value: string | undefined): boolean {
  if (!value) return false;
  const tests =
    /^E2-[^-]+-[^-]+$/.test(value) ||
    /^E-[0-9a-fA-F]{32}-[0-9a-fA-F]+$/.test(value);
  return tests;
}

const rootUrl = (req: Request) =>
  `${req.protocol}://${req.hostname}${req.hostname === 'localhost' ? `:${Settings.PORT}` : ''}`;
