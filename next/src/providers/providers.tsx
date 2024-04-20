// app/providers.tsx

import { ThingtimeProvider } from '@/remix_providers/ThingtimeProvider';
import { ChakraWrapper } from './chakra/ChakraWrapper';
import { Suspense } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ChakraWrapper>
        <ThingtimeProvider>{children}</ThingtimeProvider>
      </ChakraWrapper>
    </Suspense>
  );
}
