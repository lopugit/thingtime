import React from 'react';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { namedAccess, namedFacebookProvider, namedGoogleProvider, namedOperationsFor, namedProviderPermissions, type NamedConnectionInput, type NamedOperation } from '~/connections/namedAccess';
import { googleServiceAccess, googleServiceOperation, type NamedOperationArguments, type NamedOperationResult } from '~/connections/googleServiceActions';
import { namedConnectionBlocks, migrateNamedServiceBlocks, migrateNamedConnectionForm } from './namedConnectionBlocks';
