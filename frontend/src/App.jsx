import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { CustomerLayout, AuthLayout, AccountLayout, ProtectedRoute, GuestRoute } from './components/layout/Layouts'
import Landing from './pages/customer/Landing'
import Login from './pages/customer/Login'
import Register from './pages/customer/Register'
import Explore from './pages/customer/Explore'
import Category from './pages/customer/Category'
import ProductDetail from './pages/customer/ProductDetail'
import WriteReview from './pages/customer/WriteReview'
import Dashboard from './pages/customer/Dashboard'
import MyFeedback from './pages/customer/MyFeedback'
import Activity from './pages/customer/Activity'
import Profile from './pages/customer/Profile'
import AdminHome from './pages/admin/AdminHome'
import NotFound from './pages/NotFound'

// Route map: docs/02_ARCHITECTURE.md §8. Admin pages beyond the landing page arrive in Phase 10.
export default function App() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0) // newer Chromium returns a Promise here, so it must not be the effect's return value
  }, [pathname])

  return (
    <Routes>
      <Route element={<CustomerLayout />}>
        <Route index element={<Landing />} />
        <Route path="explore" element={<Explore />} />
        <Route path="categories/:slug" element={<Category />} />
        <Route path="products/:slug" element={<ProductDetail />} />
        <Route
          path="products/:slug/review"
          element={<ProtectedRoute role="CUSTOMER"><WriteReview /></ProtectedRoute>}
        />
        <Route path="account" element={<ProtectedRoute role="CUSTOMER"><AccountLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="feedback" element={<MyFeedback />} />
          <Route path="activity" element={<Activity />} />
          <Route path="profile" element={<Profile />} />
        </Route>
        <Route path="admin/*" element={<ProtectedRoute role="ADMIN"><AdminHome /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Route>
      <Route element={<AuthLayout />}>
        <Route path="login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="register" element={<GuestRoute><Register /></GuestRoute>} />
      </Route>
    </Routes>
  )
}
