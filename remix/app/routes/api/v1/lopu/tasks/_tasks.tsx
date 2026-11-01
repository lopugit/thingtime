import { readBackgroundTasks, stopBackgroundTask } from '~/api/utils/lopu/backgroundTasks';
export const loader = ({ request }: { request: Request }) => readBackgroundTasks(request);
export const action = ({ request }: { request: Request }) => stopBackgroundTask(request);
