import React from 'react';

// Repeated SDK surfaces give each authored instance a stable identity while
// its bound data changes. Account/page identity still fences the live runtime.
export const ComponentInstanceIdentity = React.createContext<string | undefined>(undefined);
