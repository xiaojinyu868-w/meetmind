import { redirect } from 'next/navigation';

export default function AssetsRedirect() {
  redirect('/console/knowledge?kind=document');
}
