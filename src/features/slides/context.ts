import { createContext } from 'react';
export const SlideContext = createContext({
  presenting: false, editing: null as string | null,
  edit: (_id: string | null) => {}, patch: (_id: string, _text: string) => {}, checkpoint: () => {},
});
