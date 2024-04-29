import { safe } from '~/functions/safe';

export const Safe = (props: any) => {
  // do not render more than the limit of things to prevent infinite loops

  return safe(props);
};
