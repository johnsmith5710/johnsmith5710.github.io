// Smooth scrolling for anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
  });
});

// Lightweight IntersectionObserver for header shrink
const header = document.querySelector('header');
const sentinel = document.querySelector('.hero-sentinel');

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        header.classList.remove('scrolled');  // at top → large logo + circle
      } else {
        header.classList.add('scrolled');     // scrolled past hero top → small + no circle
      }
    });
  },
  {
    rootMargin: '-1px 0px 0px 0px',  // triggers exactly when sentinel leaves viewport
    threshold: 0
  }
);

if (sentinel) {
  observer.observe(sentinel);
}
