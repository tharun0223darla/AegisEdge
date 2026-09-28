import type { Variants, Transition } from 'framer-motion';

/** Shared Framer Motion transitions and variants for consistent feel across the app. */

export const easeOutExpo: Transition = { duration: 0.45, ease: [0.22, 1, 0.36, 1] };
export const easeSpring: Transition = { type: 'spring', stiffness: 260, damping: 24 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: easeOutExpo },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: easeSpring },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: easeOutExpo },
  exit: { opacity: 0, x: 24, transition: { duration: 0.2 } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: easeOutExpo },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};
