import { useAuth } from '../../context/AuthContext'
import { PageHeader } from '../../components/layout/Layouts'
import { Notice } from '../../components/ui/States'

// Stand-in until the admin pages are built (PROJECT_TODO Phase 10). It exists so that admin
// logins and the role guard can be exercised end to end now.
export default function AdminHome() {
  const { user } = useAuth()
  return (
    <div className="page py-8">
      <PageHeader title="Administration" description={`Signed in as ${user.full_name} (${user.email}).`} />
      <Notice>
        The admin dashboard, user and product management, feedback moderation, sentiment analytics and reports
        are the next part of the build. Their API endpoints under <code className="figure text-[13px]">/api/admin</code> already work.
      </Notice>
    </div>
  )
}
