export function Footer() {
  return (
    <footer className="border-t border-gray-800 px-6 py-12 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:justify-between">
          <div>
            <span className="text-lg font-bold text-white">FlowFan</span>
            <p className="mt-1 text-xs text-gray-500">
              CRM con IA para creadores de contenido.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-6">
            <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">
              Funcionalidades
            </a>
            <a href="#showcase" className="text-sm text-gray-400 hover:text-white transition-colors">
              Demo
            </a>
            <a href="#pricing" className="text-sm text-gray-400 hover:text-white transition-colors">
              Precios
            </a>
            <a href="#faq" className="text-sm text-gray-400 hover:text-white transition-colors">
              FAQ
            </a>
            <a href="mailto:hello@flowfan.app" className="text-sm text-gray-400 hover:text-white transition-colors">
              Contacto
            </a>
          </div>
        </div>
        <div className="mt-8 border-t border-gray-800 pt-6 text-center text-xs text-gray-600">
          &copy; {new Date().getFullYear()} FlowFan. Todos los derechos reservados.
        </div>
      </div>
    </footer>
  );
}
