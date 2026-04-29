import { redirect } from 'next/navigation';

export default function PlaybookRedirect() {
  redirect('/console/knowledge?kind=playbook');
}
