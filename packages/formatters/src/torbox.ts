import { ParsedStream } from '@aiostreams/types';
import { formatSize } from './utils';
import { serviceDetails } from '@aiostreams/utils';

export function torboxFormat(stream: ParsedStream): {
  name: string;
  description: string;
} {
  let name: string = '';

  name += `${stream.addon.name}\n`;
  if (stream.provider) {
    const serviceShortName =
      serviceDetails.find((service) => service.id === stream.provider!.id)
        ?.shortName || stream.provider.id;
    name += `(${serviceShortName}${stream.provider.cached === undefined ? ' Unknown' : stream.provider.cached ? ' Instant' : ''})\n`;
  }

  if (stream.torrent?.infoHash) {
    name += `(P2P)\n`;
  }

  name += `${stream.personal ? '(Your Media) ' : ''}(${stream.resolution})`;

  let description: string = '';

  description += `Quality: ${stream.quality}\nName: ${stream.filename || 'Unknown'}\nSize: ${stream.size ? formatSize(stream.size) : 'Unknown'}${stream.indexers ? `| Source: ${stream.indexers}` : ''}\nLanguage: ${stream.languages.length > 0 ? stream.languages.join(', ') : 'Unknown'}`;

  let streamType = '';
  if (stream?.torrent?.seeders) {
    streamType = 'Torrent';
  } else if (stream?.usenet?.age) {
    streamType = 'Usenet';
  }

  if (streamType === 'Torrent' || streamType === 'Usenet') {
    description += `Type: ${streamType} | ${streamType === 'Torrent' ? 'Seeders' : 'Age'}: ${streamType === 'Torrent' ? stream.torrent?.seeders : stream.usenet?.age}`;
  }

  if (stream.message) {
    description += `\n${stream.message}`;
  }

  return { name, description };
}
