import { Global } from '@emotion/react';

export const GlobalStyles = () => {
  return (
    <Global
      styles={{
        body: {},
        'input[data-com-onepassword-filled="light"]': {
          // Doesn't seem to work..?
          background: 'pink !important'
        }
      }}
    />
  );
};
