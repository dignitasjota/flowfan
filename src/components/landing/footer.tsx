export function Footer() {
  return (
    <footer className="border-t border-gray-800 px-6 py-12 lg:px-8">
      <div className="mx-auto max-w-5xl flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-white">FanFlow</span>
          <span className="text-sm text-gray-500">
            &copy; {new Date().getFullYear()}
          </span>
        </div>
        <div className="flex gap-6">
          <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
            Features
          </a>
          <a href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
            Pricing
          </a>
          <a href="#faq" className="text-sm text-gray-400 hover:text-white transition-colors">
            FAQ
          </a>
        </div>
      </div>
    </footer>
  );
}
