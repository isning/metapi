import { apiResources } from './api.js';
import { appResources } from './app.js';
import { commonResources } from './common.js';
import { componentsResources } from './components.js';
import { loginErrorResources } from './login-error.js';
import { pagesResources } from './pages.js';
import { upstreamCompatibilityResources } from './upstream-compatibility.js';
import { upstreamCostPricingResources } from './upstream-cost-pricing.js';

const resourceGroups = [
  apiResources,
  appResources,
  commonResources,
  componentsResources,
  loginErrorResources,
  pagesResources,
  upstreamCompatibilityResources,
  upstreamCostPricingResources,
] as const;

export const webI18nResources = {
  zh: Object.assign({}, ...resourceGroups.map((group) => group.zh)) as Record<string, string>,
  en: Object.assign({}, ...resourceGroups.map((group) => group.en)) as Record<string, string>,
} as const;
