import { AnimatePresence, motion } from "framer-motion";

export function PageViewer({
  page,
  thumbnails,
  onNavigate,
  onClose,
}: {
  page: number | null;
  thumbnails: string[];
  onNavigate: (page: number) => void;
  onClose: () => void;
}) {
  const src = page !== null ? thumbnails[page - 1] : undefined;
  return (
    <AnimatePresence>
      {page !== null && src && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="page-viewer glass"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header>
              <h3>
                Page {page} / {thumbnails.length}
              </h3>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>
            <img src={src} alt={`Portfolio page ${page}`} />
            <div className="nav">
              <button
                className="icon-btn"
                disabled={page <= 1}
                onClick={() => onNavigate(page - 1)}
                aria-label="Previous page"
              >
                ←
              </button>
              <button
                className="icon-btn"
                disabled={page >= thumbnails.length}
                onClick={() => onNavigate(page + 1)}
                aria-label="Next page"
              >
                →
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
