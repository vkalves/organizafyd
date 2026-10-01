import { createContext } from 'react';
export const SlideContext = createContext({
  mediaSize: (_id: string, _src: string | undefined, _width: number, _height: number) => {},
  presenting: false, editing: null as string | null,
  edit: (_id: string | null) => {}, patch: (_id: string, _text: string) => {}, checkpoint: () => {},
});
