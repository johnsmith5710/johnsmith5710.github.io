// Smooth scrolling for anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
  });
});

// Header scroll trigger with bidirectional forced completion
const header = document.querySelector('header');
const downTrigger = 30;           // px down to trigger scrolled state
const upTrigger = 200;            // px from top to trigger reset (hysteresis to avoid instant flip)
const targetDown = 250;           // final scroll position when going down
let isAnimating = false;
let lastScrollY = 0;

function handleScroll() {
  if (isAnimating) return;

  const scrollY = window.scrollY;
  const scrollingDown = scrollY > lastScrollY;

  if (scrollingDown && scrollY > downTrigger && !header.classList.contains('scrolled')) {
    // Going down → force to scrolled state + scroll to target
    header.classList.add('scrolled');
    isAnimating = true;

    window.scrollTo({
      top: targetDown,
      behavior: 'smooth'
    });

    setTimeout(() => { isAnimating = false; }, 1000);
  } else if (!scrollingDown && scrollY < upTrigger && header.classList.contains('scrolled')) {
    // Going up → force back to top state
    header.classList.remove('scrolled');
    isAnimating = true;

    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });

    setTimeout(() => { isAnimating = false; }, 1000);
  }

  lastScrollY = scrollY;
}

window.addEventListener('scroll', handleScroll);

// Initial check
handleScroll();
