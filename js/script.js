// Smooth scrolling for anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
  });
});

// Header shrink with hysteresis using two sentinels
const header = document.querySelector('header');
const topSentinel = document.querySelector('.hero-sentinel');       // higher – for removing 'scrolled'
const bottomSentinel = document.querySelector('.hero-sentinel-up'); // lower – for adding 'scrolled'

// Observer to ADD scrolled state (when scrolling down past bottom sentinel)
const addScrolledObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) {
      header.classList.add('scrolled');
    }
  });
}, { threshold: 0 });

// Observer to REMOVE scrolled state (when scrolling up to top sentinel)
const removeScrolledObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      header.classList.remove('scrolled');
    }
  });
}, { threshold: 0 });

if (bottomSentinel) addScrolledObserver.observe(bottomSentinel);
if (topSentinel) removeScrolledObserver.observe(topSentinel);

// Initial state on load/refresh
if (window.scrollY > 50) {  // approximate the 50px zone
  header.classList.add('scrolled');
}
