/** Simulation uses a timer independent of painting and document visibility. */
export class SimulationClock {
  constructor({step=1/60,maxSteps=240,onStep=()=>{}}={}) {
    this.step=step;this.maxSteps=maxSteps;this.onStep=onStep;this.reset(0);
  }
  reset(now){this.last=Number.isFinite(now)?now:0;this.accumulator=0;this.running=false;}
  advance(now,{running=false,speed=1}={}) {
    if(!Number.isFinite(now))return 0;
    const dt=Math.max(0,now-this.last);this.last=now;
    if(!running){this.accumulator=0;this.running=false;return 0;}
    if(!this.running){this.running=true;return 0;}
    const rate=[1,4,16,60].includes(speed)?speed:1;
    this.accumulator+=dt*rate;
    let count=0;
    while(this.accumulator+1e-12>=this.step&&count<this.maxSteps){
      this.onStep(this.step);this.accumulator=Math.max(0,this.accumulator-this.step);count++;
    }
    return count;
  }
}
