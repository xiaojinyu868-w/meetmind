import { redirect } from 'next/navigation';

export default function SourcesRedirect() {
  redirect('/console/knowledge?kind=source');
}
