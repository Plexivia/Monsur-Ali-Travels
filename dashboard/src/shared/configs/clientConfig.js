import { APP_NAME } from './appConfig';

export const clientConfig = {
  clientKey: 'monsuralitravels',
  brandName: APP_NAME || 'Monsur Ali Travels',
  domain: typeof window !== 'undefined' ? window.location.hostname : 'monsuralitravelsbd.com',
};

export default clientConfig;
