import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('@istanbuljs/esm-loader-hook', pathToFileURL('./'));