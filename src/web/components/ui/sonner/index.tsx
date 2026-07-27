import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  if (import.meta.env.MODE === 'test') return null;

  return (
    <Sonner
      richColors
      closeButton
      position="top-right"
      duration={3200}
      {...props}
    />
  );
}

export { Toaster };
