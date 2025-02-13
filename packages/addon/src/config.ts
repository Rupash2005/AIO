import { AddonDetail, Config } from '@aiostreams/types';
import {
  addonDetails,
  serviceDetails,
  Settings,
  unminifyConfig,
} from '@aiostreams/utils';

export const allowedFormatters = [
  'gdrive',
  'minimalistic-gdrive',
  'torrentio',
  'torbox',
  'imposter',
];

export const allowedLanguages = [
  'Multi',
  'English',
  'Japanese',
  'Chinese',
  'Russian',
  'Arabic',
  'Portuguese',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Korean',
  'Hindi',
  'Bengali',
  'Punjabi',
  'Marathi',
  'Gujarati',
  'Tamil',
  'Telugu',
  'Kannada',
  'Malayalam',
  'Thai',
  'Vietnamese',
  'Indonesian',
  'Turkish',
  'Hebrew',
  'Persian',
  'Ukrainian',
  'Greek',
  'Lithuanian',
  'Latvian',
  'Estonian',
  'Polish',
  'Czech',
  'Slovak',
  'Hungarian',
  'Romanian',
  'Bulgarian',
  'Serbian',
  'Croatian',
  'Slovenian',
  'Dutch',
  'Danish',
  'Finnish',
  'Swedish',
  'Norwegian',
  'Malay',
  'Latino',
  'Unknown',
  'Dual Audio',
  'Dubbed',
];

export function validateConfig(config: Config): {
  valid: boolean;
  errorCode: string | null;
  errorMessage: string | null;
} {
  config = unminifyConfig(config);
  const createResponse = (
    valid: boolean,
    errorCode: string | null,
    errorMessage: string | null
  ) => {
    return { valid, errorCode, errorMessage };
  };

  if (config.addons.length < 1) {
    return createResponse(
      false,
      'noAddons',
      'At least one addon must be selected'
    );
  }

  if (config.addons.length > Settings.MAX_ADDONS) {
    return createResponse(
      false,
      'tooManyAddons',
      `You can only select a maximum of ${Settings.MAX_ADDONS} addons`
    );
  }

  // check for any duplicate addons where both the ID and options are the same
  const duplicateAddons = config.addons.filter(
    (addon, index) =>
      config.addons.findIndex(
        (a) =>
          a.id === addon.id &&
          JSON.stringify(a.options) === JSON.stringify(addon.options)
      ) !== index
  );

  if (duplicateAddons.length > 0) {
    return createResponse(
      false,
      'duplicateAddons',
      'Duplicate addons found. Please remove any duplicates'
    );
  }

  for (const addon of config.addons) {
    if (Settings.DISABLE_TORRENTIO && addon.id === 'torrentio') {
      return createResponse(
        false,
        'torrentioDisabled',
        Settings.DISABLE_TORRENTIO_MESSAGE
      );
    }

    const details = addonDetails.find(
      (detail: AddonDetail) => detail.id === addon.id
    );
    if (!details) {
      return createResponse(
        false,
        'invalidAddon',
        `Invalid addon: ${addon.id}`
      );
    }
    if (details.requiresService) {
      const supportedServices = details.supportedServices;
      const isAtLeastOneServiceEnabled = config.services.some(
        (service) => supportedServices.includes(service.id) && service.enabled
      );
      const isOverrideUrlSet = addon.options?.overrideUrl;
      if (!isAtLeastOneServiceEnabled && !isOverrideUrlSet) {
        return createResponse(
          false,
          'missingService',
          `${addon.options?.name || details.name} requires at least one of the following services to be enabled: ${supportedServices
            .map(
              (service) =>
                serviceDetails.find((detail) => detail.id === service)?.name ||
                service
            )
            .join(', ')}`
        );
      }
    }
    if (details.options) {
      for (const option of details.options) {
        if (option.required && !addon.options[option.id]) {
          return createResponse(
            false,
            'missingRequiredOption',
            `Option ${option.label} is required for addon ${addon.id}`
          );
        }

        if (
          option.id.toLowerCase().includes('url') &&
          addon.options[option.id]
        ) {
          if (
            Settings.DISABLE_TORRENTIO &&
            addon.options[option.id]?.match(/torrentio\.strem\.fun/) !== null
          ) {
            // if torrentio is disabled, don't allow the user to set URLs with torrentio.strem.fun
            return createResponse(
              false,
              'torrentioDisabled',
              Settings.DISABLE_TORRENTIO_MESSAGE
            );
          } else if (
            Settings.DISABLE_TORRENTIO &&
            addon.options[option.id]?.match(/stremthru\.elfhosted\.com/) !==
              null
          ) {
            // if torrentio is disabled, we need to inspect the stremthru URL to see if it's using torrentio
            try {
              const url = new URL(addon.options[option.id] as string);
              // get the component before manifest.json
              const pathComponents = url.pathname.split('/');
              if (pathComponents.includes('manifest.json')) {
                const index = pathComponents.indexOf('manifest.json');
                const componentBeforeManifest = pathComponents[index - 1];
                // base64 decode the component before manifest.json
                const decodedComponent = atob(componentBeforeManifest);
                const stremthruData = JSON.parse(decodedComponent);
                if (stremthruData?.manifest_url?.match(/torrentio.strem.fun/)) {
                  return createResponse(
                    false,
                    'torrentioDisabled',
                    Settings.DISABLE_TORRENTIO_MESSAGE
                  );
                }
              }
            } catch (_) {
              // ignore
            }
          } else if (
            addon.options[option.id]?.match(
              /^E-[0-9a-fA-F]{32}-[0-9a-fA-F]+$/
            ) === null &&
            addon.options[option.id]?.match(/^E2-[^-]+-[^-]+$/) === null
          ) {
            try {
              new URL(addon.options[option.id] as string);
            } catch (_) {
              return createResponse(
                false,
                'invalidUrl',
                ` Invalid URL for ${option.label}`
              );
            }
          }
        }

        if (option.type === 'number' && addon.options[option.id]) {
          const input = addon.options[option.id];
          if (input !== undefined && !parseInt(input)) {
            return createResponse(
              false,
              'invalidNumber',
              `${option.label} must be a number`
            );
          } else if (input !== undefined) {
            const value = parseInt(input);
            const { min, max } = option.constraints || {};
            if (
              (min !== undefined && value < min) ||
              (max !== undefined && value > max)
            ) {
              return createResponse(
                false,
                'invalidNumber',
                `${option.label} must be between ${min} and ${max}`
              );
            }
          }
        }
      }
    }
  }

  if (!allowedFormatters.includes(config.formatter)) {
    if (config.formatter === 'custom') {
      if (!config.customFormatter) {
        return createResponse(
          false,
          'missingCustomFormatter',
          'Custom formatter is required if custom formatter is selected'
        );
      }
    } else {
      return createResponse(
        false,
        'invalidFormatter',
        `Invalid formatter: ${config.formatter}`
      );
    }
  }
  for (const service of config.services) {
    if (service.enabled) {
      const serviceDetail = serviceDetails.find(
        (detail) => detail.id === service.id
      );
      if (!serviceDetail) {
        return createResponse(
          false,
          'invalidService',
          `Invalid service: ${service.id}`
        );
      }
      for (const credential of serviceDetail.credentials) {
        if (!service.credentials[credential.id]) {
          return createResponse(
            false,
            'missingCredential',
            `${credential.label} is required for ${service.name}`
          );
        }
      }
    }
  }

  // need at least one visual tag, resolution, quality

  if (
    !config.visualTags.some((tag) => Object.values(tag)[0]) ||
    !config.resolutions.some((resolution) => Object.values(resolution)[0]) ||
    !config.qualities.some((quality) => Object.values(quality)[0])
  ) {
    return createResponse(
      false,
      'noFilters',
      'At least one visual tag, resolution, and quality must be selected'
    );
  }

  for (const [min, max] of [
    [config.minMovieSize, config.maxMovieSize],
    [config.minEpisodeSize, config.maxEpisodeSize],
    [config.minSize, config.maxSize],
  ]) {
    if (min && max) {
      if (min >= max) {
        return createResponse(
          false,
          'invalidSizeRange',
          "Your minimum size limit can't be greater than or equal to your maximum size limit"
        );
      }
    }
  }

  if (config.maxResultsPerResolution && config.maxResultsPerResolution < 1) {
    return createResponse(
      false,
      'invalidMaxResultsPerResolution',
      'Max results per resolution must be greater than 0'
    );
  }

  if (config.mediaFlowConfig?.mediaFlowEnabled) {
    if (!config.mediaFlowConfig.proxyUrl) {
      return createResponse(
        false,
        'missingProxyUrl',
        'Proxy URL is required if MediaFlow is enabled'
      );
    }
    if (!config.mediaFlowConfig.apiPassword) {
      return createResponse(
        false,
        'missingApiPassword',
        'API Password is required if MediaFlow is enabled'
      );
    }
  }
  if (
    (config.excludeFilters?.length ?? 0) > Settings.MAX_KEYWORD_FILTERS ||
    (config.strictIncludeFilters?.length ?? 0) > Settings.MAX_KEYWORD_FILTERS
  ) {
    return createResponse(
      false,
      'tooManyFilters',
      `You can only have a maximum of ${Settings.MAX_KEYWORD_FILTERS} filters`
    );
  }

  const filters = [
    ...(config.excludeFilters || []),
    ...(config.strictIncludeFilters || []),
  ];
  filters.forEach((filter) => {
    if (filter.length > 20) {
      return createResponse(
        false,
        'invalidFilter',
        'One of your filters is too long'
      );
    }
    if (!filter) {
      return createResponse(
        false,
        'invalidFilter',
        'Filters must not be empty'
      );
    }
  });

  return createResponse(true, null, null);
}
