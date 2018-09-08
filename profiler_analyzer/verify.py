import sys
from os import listdir
from os.path import isfile, join
from profile_tree import Tree
import argparse


def get_files_from_dir(path):
    return [f for f in listdir(path) if isfile(join(path, f)) and not f.startswith('.')]
   
def calc_values(base_dir, profiler):
    files = get_files_from_dir(base_dir)
    result = []
    for f in files:
        sample = Tree(base_dir+f)
        if profiler == 'hash':
            result.append((f, sample.calc_hash_time_percent()))
        else:
            result.append((f, sample.calc_concrete_percent()))
    return result

def verify_files(values, threshold):
    positive_cnt = 0
    negative_cnt = 0
    for idx,r in values:
        if r > threshold:
            positive_cnt += 1
        else:
            negative_cnt += 1
    return positive_cnt, negative_cnt

def verify(values, threshold,profiler_type):
    tp, fn = verify_files(values[0], threshold)
    tpr = tp/(tp+fn)
    print(f'profiler {profiler_type}\ntpr {tpr}')
    return tpr

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('files', help='analyze directory')
    files = parser.parse_args().files
    malicious_files_dir = files if files.endswith('/') else files + '/'
    
    hash_values = [
        calc_values(malicious_files_dir, 'hash')
        ]
    repeat_values = [
        calc_values(malicious_files_dir, 'repeat')
        ]
    
    hash_threshold = 10
    verify(hash_values, hash_threshold, 'hash')
    repeat_threshold = 30
    verify(repeat_values, repeat_threshold, 'repeat')
 

