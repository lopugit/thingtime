import type { CreateToastFnReturn, UseToastOptions } from '@chakra-ui/react';

type ToastDelivery = Pick<CreateToastFnReturn, 'isActive' | 'update'> & ((options?: UseToastOptions) => string | number);

/** A caller may replace its own visible feedback without coalescing distinct
 * history events or touching another screen's/account's notifications. */
export function deliverLopuToast(toast: ToastDelivery, options: UseToastOptions, key?: string, ownerId?: string) {
  const id = key === undefined ? undefined : JSON.stringify(['lopu', ownerId ?? null, key]);
  if (id !== undefined && toast.isActive(id)) {
    toast.update(id, options);
    return id;
  }
  return toast({ ...options, ...(id === undefined ? {} : { id }) });
}
