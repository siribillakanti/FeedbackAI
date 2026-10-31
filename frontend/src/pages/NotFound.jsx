import { EmptyState } from '../components/ui/States'
import { ButtonLink } from '../components/ui/Button'

export default function NotFound() {
  return (
    <div className="page py-16">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState title="Page not found" action={<ButtonLink to="/" variant="secondary">Go to the home page</ButtonLink>}>
        The address may be mistyped, or the page has moved.
      </EmptyState>
    </div>
  )
}
