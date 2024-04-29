// modify window / globalThis to support any properties
// so there's no property does not exist on window typescript errors

// Path: app/global-types.d.ts
declare global {
  interface Window {
    [key: string]: any;
  }
  
  // Modify React component props/args to allow anything
  // so we don't get errors 
  // Property 'fullPath' does not exist on type '{ children?: ReactNode; }'.
  
  interface ForwardRefRenderFunction {
    T: any;
    (props: any, ref: React.Ref<any>): React.ReactElement | null;
  }
  
}

export {};
